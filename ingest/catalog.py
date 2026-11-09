"""Source catalog. Status is about this build, not about the whole country."""

from __future__ import annotations

COVERAGE_NOTE = (
    "This build does not list every U.S. government bid. It ingests the SAM.gov "
    "Contract Opportunities public extract (federal notices in the configured NAICS "
    "families), the Suffolk County, NY Bonfire public RSS (category-matched open "
    "notices from that one organization), and NYC City Record Online solicitations "
    "(category-matched, with a due date). Other Bonfire organizations, BidNet, "
    "RFPMart, PlanetBids, NYS Contract Reporter, and NYC PASSPort bulk listings "
    "are not ingested."
)


def catalog() -> list[dict]:
    return [
        {
            "id": "sam-public-csv",
            "name": "SAM.gov Contract Opportunities public extract",
            "status": "working",
            "jurisdiction": "federal",
            "auth": "none",
            "coverage": "Active federal contract notices in the daily public CSV, kept when the NAICS code is in the existing web, IT, marketing, and related families.",
            "feedUrl": "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public",
            "docsUrl": "https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public",
            "notes": "No API key. The file is regenerated about once a day and can lag the SAM.gov website. Award notices are not listed.",
        },
        {
            "id": "sam-opportunities-api",
            "name": "SAM.gov Get Opportunities Public API",
            "status": "config-required",
            "jurisdiction": "federal",
            "auth": "api-key",
            "coverage": "Same federal notices as SAM.gov, only when a key is configured and SAM_API_ENABLE=1. Not a second copy of the full extract.",
            "feedUrl": "https://api.sam.gov/opportunities/v2/search",
            "docsUrl": "https://open.gsa.gov/api/get-opportunities-public-api/",
            "notes": "A personal public API key from a SAM.gov account is required. This build does not create that account. With no key, zero API rows are added.",
        },
        {
            "id": "bonfire-suffolkcountyny",
            "name": "Suffolk County, NY Bonfire public RSS",
            "status": "working",
            "jurisdiction": "local",
            "auth": "none",
            "coverage": "Currently open public opportunities for this one Bonfire organization, then filtered to website, app, software, design, and marketing phrases.",
            "feedUrl": "https://suffolkcountyny.bonfirehub.com/opportunities/rss",
            "docsUrl": "https://suffolkcountyny.bonfirehub.com/opportunities/rss",
            "notes": "Keyless RSS. There is no public master list of Bonfire organizations, so other tenants are not covered. RSS close times have disagreed with the official RFP clock (Suffolk tourism: RSS 12:00 AM EST vs a reported RFP time of 3:30 PM). PDFs are not parsed.",
        },
        {
            "id": "nyc-crol",
            "name": "NYC City Record Online",
            "status": "working",
            "jurisdiction": "local",
            "auth": "none",
            "coverage": "City Record solicitation notices from Socrata dataset dg92-zbpx with a due date, filtered to the same category phrases. Historical rows that are already due are not listed.",
            "feedUrl": "https://data.cityofnewyork.us/resource/dg92-zbpx.json",
            "docsUrl": "https://data.cityofnewyork.us/City-Government/City-Record-Online/dg92-zbpx",
            "notes": "Public SODA API, no key required for this volume. due_date has no timezone in the feed and is displayed as America/New_York. PASSPort is not bulk-ingested.",
        },
        {
            "id": "nyc-passport",
            "name": "NYC PASSPort public browse",
            "status": "manual",
            "jurisdiction": "local",
            "auth": "account-for-submit",
            "coverage": "Not ingested. The public browse page is a website, not a bulk feed.",
            "feedUrl": "https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public",
            "docsUrl": "https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public",
            "notes": "A link here is not coverage. City Record notices often tell vendors to submit in PASSPort. No per-solicitation PASSPort URL is invented.",
        },
        {
            "id": "nyscr",
            "name": "NYS Contract Reporter",
            "status": "manual",
            "jurisdiction": "state",
            "auth": "free-registration",
            "coverage": "Not ingested. Official New York State opportunity publication. Ads require a free account. No public API or RSS was found.",
            "feedUrl": "https://www.nyscr.ny.gov/",
            "docsUrl": "https://www.nyscr.ny.gov/",
            "notes": "Do not script this site. Agency registration terms prohibit automated bulk access that bypasses the interactive controls.",
        },
        {
            "id": "bidnet",
            "name": "BidNet Direct",
            "status": "unsupported",
            "jurisdiction": "state-local",
            "auth": "membership",
            "coverage": "Not ingested. No free bulk API was found.",
            "feedUrl": "",
            "docsUrl": "https://www.bidnetdirect.com/public/solicitations/open",
            "notes": "BidNet listings come from member agencies that publish into purchasing groups, plus a separate statewide layer BidNet aggregates from public websites and newspapers. A public search page is not a feed, and this build does not copy BidNet's corpus.",
        },
        {
            "id": "rfpmart",
            "name": "RFPMart",
            "status": "unsupported",
            "jurisdiction": "aggregator",
            "auth": "subscription",
            "coverage": "Not ingested. Downstream aggregator, not a primary source.",
            "feedUrl": "",
            "docsUrl": "https://www.rfpmartllc.com/about-rfpmart-llc.html",
            "notes": "RFPMart describes researchers and website crawlers that collect solicitations from government sites, including a SAM.gov crawler, then sell search and documents. Their marketing claims of complete U.S. coverage are not treated as fact. This build does not copy that corpus or its RSS.",
        },
        {
            "id": "planetbids",
            "name": "PlanetBids",
            "status": "unsupported",
            "jurisdiction": "state-local",
            "auth": "portal-account",
            "coverage": "Not ingested. No documented keyless bulk feed is used.",
            "feedUrl": "",
            "docsUrl": "https://www.planetbids.com/",
            "notes": "Vendor portals are account-gated. Undocumented portal JSON reported by scrapers is not called. A homepage link is not coverage.",
        },
        {
            "id": "opengov",
            "name": "OpenGov Procurement",
            "status": "unsupported",
            "jurisdiction": "state-local",
            "auth": "customer-api-key",
            "coverage": "Not ingested. Documented APIs are keyed and scoped to a customer entity, not a public all-tenant bid dump.",
            "feedUrl": "",
            "docsUrl": "https://developer.opengov.com/catalog",
            "notes": "No keyless global feed is wired, and no OpenGov key is configured.",
        },
        {
            "id": "ionwave",
            "name": "IonWave / BidSync",
            "status": "unsupported",
            "jurisdiction": "state-local",
            "auth": "portal-account",
            "coverage": "Not ingested. No verified public keyless API or RSS.",
            "feedUrl": "",
            "docsUrl": "",
            "notes": "Treated as a login portal. Not covered.",
        },
    ]
