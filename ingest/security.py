"""HTTPS fetch with an allowlist, redirect checks, and a small rate limit.

Only public, documented endpoints are fetched. Redirect targets are checked
again so a 303 cannot send the client to a private or unexpected host.
"""

from __future__ import annotations

import ipaddress
import socket
import time
import urllib.request
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse, urlunparse

import io

REDIRECTS = {301, 302, 303, 307, 308}
USER_AGENT = (
    "q8-bid-finder/0.2 (+https://github.com/aklocalsolutions-create/bid-finder; "
    "public-data ingest)"
)


class FetchError(Exception):
    pass


class SecurityError(FetchError):
    pass


class CapturedRedirect(Exception):
    def __init__(self, code: int, url: str):
        super().__init__(f"redirect {code}")
        self.code = code
        self.url = url


class _CaptureRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CapturedRedirect(code, newurl)


class _ReturnResponse(urllib.request.HTTPErrorProcessor):
    def http_response(self, request, response):
        return response

    https_response = http_response


def default_opener():
    return urllib.request.build_opener(_CaptureRedirect, _ReturnResponse)


def redact_url(url: str) -> str:
    parts = urlparse(url)
    return urlunparse((parts.scheme, parts.netloc, parts.path, "", "", ""))


def ip_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    if (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    ):
        return True
    if addr.version == 4 and (
        addr in ipaddress.ip_network("100.64.0.0/10")
        or addr in ipaddress.ip_network("198.18.0.0/15")
    ):
        return True
    return False


def resolve_ips(host: str, resolver=None):
    try:
        ipaddress.ip_address(host)
        return [host]
    except ValueError:
        pass
    resolver = resolver or socket.getaddrinfo
    infos = resolver(host, 443, type=socket.SOCK_STREAM)
    ips = []
    for info in infos:
        if isinstance(info, str):
            ips.append(info)
        else:
            ips.append(info[4][0])
    if not ips:
        raise SecurityError(f"no addresses for {host}")
    return ips


def validate_url(url: str, *, phase: str, policy, resolver=None) -> None:
    parts = urlparse(url)
    if parts.username or parts.password:
        raise SecurityError("refusing a URL that contains credentials")
    if parts.scheme != "https":
        raise SecurityError(f"refusing non-HTTPS URL ({parts.scheme or 'missing'})")
    if parts.port not in (None, 443):
        raise SecurityError(f"refusing non-443 port on {parts.hostname}")
    host = parts.hostname
    if not host:
        raise SecurityError("URL is missing a host")
    if not policy(url, phase):
        raise SecurityError(f"{host} is not on the allowlist for this request")
    for ip in resolve_ips(host, resolver):
        if ip_blocked(ip):
            raise SecurityError(f"refusing non-public address for {host}")


class RateLimiter:
    def __init__(self, min_interval=1.0, max_requests=40, sleep=None, clock=None):
        self.min_interval = min_interval
        self.max_requests = max_requests
        self.sleep = sleep or time.sleep
        self.clock = clock or time.monotonic
        self._last = {}
        self.sent = 0

    def wait(self, host: str) -> None:
        if self.sent >= self.max_requests:
            raise SecurityError("per-run request limit reached")
        now = self.clock()
        last = self._last.get(host)
        if last is not None:
            delay = self.min_interval - (now - last)
            if delay > 0:
                self.sleep(delay)
                now = self.clock()
        self._last[host] = now
        self.sent += 1


@dataclass
class HttpResult:
    status: int
    final_url: str
    headers: dict
    body: bytes


def _header_map(headers) -> dict:
    if headers is None:
        return {}
    return {str(k): str(v) for k, v in headers.items()}


def header_get(headers: dict, name: str) -> str:
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return ""


def fetch(
    url: str,
    *,
    policy,
    limiter: RateLimiter,
    timeout: float = 45,
    max_bytes: int = 2_000_000,
    headers=None,
    opener=None,
    resolver=None,
    max_hops: int = 3,
    dest_path: str | None = None,
) -> HttpResult:
    """GET `url`. When dest_path is set, the body is written there and not returned."""
    opener = opener or default_opener().open
    current = url
    phase = "start"
    extra = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        extra.update(headers)
    for _ in range(max_hops + 1):
        validate_url(current, phase=phase, policy=policy, resolver=resolver)
        host = urlparse(current).hostname or ""
        limiter.wait(host)
        req = urllib.request.Request(current, headers=extra, method="GET")
        try:
            resp = opener(req, timeout=timeout)
        except CapturedRedirect as redir:
            if not redir.url:
                raise FetchError("redirect had no Location")
            current = urljoin(current, redir.url)
            phase = "redirect"
            continue
        status = getattr(resp, "status", None) or resp.getcode()
        hdrs = _header_map(getattr(resp, "headers", {}))
        if status in REDIRECTS:
            loc = header_get(hdrs, "Location")
            _drain(resp)
            if not loc:
                raise FetchError("redirect had no Location")
            current = urljoin(current, loc)
            phase = "redirect"
            continue
        if status not in (200, 206):
            _drain(resp)
            raise FetchError(f"HTTP {status} from {urlparse(current).hostname}")
        body = b""
        if dest_path:
            written = _write_limited(resp, dest_path, max_bytes)
            body = b""
            size = written
        else:
            body = _read_limited(resp, max_bytes)
            size = len(body)
        final = getattr(resp, "geturl", lambda: current)()
        _close(resp)
        if size > max_bytes:
            raise FetchError("response exceeded the size limit")
        return HttpResult(status=status, final_url=final, headers=hdrs, body=body)
    raise FetchError("too many redirects")


def _read_limited(resp, max_bytes: int) -> bytes:
    buf = io.BytesIO()
    remaining = max_bytes + 1
    while remaining > 0:
        chunk = resp.read(min(65536, remaining))
        if not chunk:
            break
        buf.write(chunk)
        remaining -= len(chunk)
    if remaining <= 0:
        raise FetchError("response exceeded the size limit")
    return buf.getvalue()


def _write_limited(resp, dest_path: str, max_bytes: int) -> int:
    total = 0
    with open(dest_path, "wb") as fh:
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise FetchError("response exceeded the size limit")
            fh.write(chunk)
    return total


def _drain(resp) -> None:
    try:
        resp.read(2048)
    except Exception:
        pass
    _close(resp)


def _close(resp) -> None:
    close = getattr(resp, "close", None)
    if close:
        try:
            close()
        except Exception:
            pass


def _https(url: str) -> bool:
    return urlparse(url).scheme == "https"


def sam_csv_policy(url: str, phase: str) -> bool:
    if not _https(url):
        return False
    parts = urlparse(url)
    host = (parts.hostname or "").lower()
    path = _unquote_path(parts.path)
    if phase == "start":
        return (
            host == "sam.gov"
            and path.startswith("/api/prod/fileextractservices/v1/api/download/")
            and "Contract Opportunities" in path
        ) or (
            host == "s3.amazonaws.com"
            and path.startswith("/falextracts/Contract Opportunities/datagov/")
        )
    if host == "falextracts.s3.amazonaws.com" and path.startswith(
        "/Contract Opportunities/datagov/"
    ):
        return True
    if host == "s3.amazonaws.com" and path.startswith(
        "/falextracts/Contract Opportunities/datagov/"
    ):
        return True
    return False


def sam_api_policy(url: str, phase: str) -> bool:
    if not _https(url):
        return False
    parts = urlparse(url)
    host = (parts.hostname or "").lower()
    path = parts.path
    return phase == "start" and host == "api.sam.gov" and path.startswith(
        "/opportunities/v2/search"
    )


def bonfire_policy_for(slugs) -> callable:
    hosts = {f"{slug.lower()}.bonfirehub.com" for slug in slugs}

    def policy(url: str, phase: str) -> bool:
        if not _https(url):
            return False
        parts = urlparse(url)
        host = (parts.hostname or "").lower()
        return (
            phase == "start"
            and host in hosts
            and parts.path.rstrip("/") == "/opportunities/rss"
        )

    return policy


def nyc_policy(url: str, phase: str) -> bool:
    if not _https(url):
        return False
    parts = urlparse(url)
    host = (parts.hostname or "").lower()
    return (
        phase == "start"
        and host == "data.cityofnewyork.us"
        and parts.path.startswith("/resource/dg92-zbpx")
    )


def _unquote_path(path: str) -> str:
    from urllib.parse import unquote

    return unquote(path)
