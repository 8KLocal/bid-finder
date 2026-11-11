#!/usr/bin/env python3
"""Write assets/share.png for Open Graph and Twitter. Standard library only."""
import pathlib
import struct
import zlib

W, H = 1200, 630
NAVY = (12, 35, 64)
RED = (155, 35, 53)
WHITE = (255, 255, 255)

# 5x7 glyphs. Each row is five bits.
FONT = {
    " ": ["00000"] * 7,
    "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
    "·": ["00000", "00000", "00000", "00100", "00000", "00000", "00000"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}


def png(width, height, rgb):
    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def put(buf, x, y, color, scale=1):
    for dy in range(scale):
        yy = y + dy
        if yy < 0 or yy >= H:
            continue
        for dx in range(scale):
            xx = x + dx
            if 0 <= xx < W:
                i = (yy * W + xx) * 3
                buf[i:i + 3] = bytes(color)


def text(buf, line, x, y, scale, color=WHITE):
    cursor = x
    for ch in line:
        glyph = FONT[ch]
        for row, bits in enumerate(glyph):
            for col, bit in enumerate(bits):
                if bit == "1":
                    put(buf, cursor + col * scale, y + row * scale, color, scale)
        cursor += 6 * scale
    return cursor - x


def main():
    buf = bytearray(NAVY * 3 * W * H)
    for y in range(H - 28, H):
        for x in range(W):
            i = (y * W + x) * 3
            buf[i:i + 3] = bytes(RED)
    lines = [
        ("IT'S WORKPLACE", 10),
        ("OPEN US GOVERNMENT BIDS", 8),
        ("FEDERAL · STATE · COUNTY · CITY", 5),
        ("REFRESHED DAILY", 5),
    ]
    y = 150
    for line, scale in lines:
        width = text(buf, line, 0, -100, scale)
        text(buf, line, (W - width) // 2, y, scale)
        y += 8 * scale + 28
    out = pathlib.Path(__file__).resolve().parents[1] / "assets" / "share.png"
    out.write_bytes(png(W, H, buf))
    print(out, out.stat().st_size)


if __name__ == "__main__":
    main()
