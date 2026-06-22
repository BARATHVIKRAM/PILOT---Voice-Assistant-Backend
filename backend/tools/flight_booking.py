"""Flight and customer care booking tools — real-time via Node MCP or fallback."""
import uuid, logging, datetime, os, re, shlex, json
import httpx
from core.config import settings

logger = logging.getLogger("pilot.tools.flights")

CITY_TO_CODE: dict[str, str] = {
    "delhi": "DEL", "new delhi": "DEL",
    "mumbai": "BOM", "bombay": "BOM",
    "bangalore": "BLR", "bengaluru": "BLR",
    "chennai": "MAA", "madras": "MAA",
    "kolkata": "CCU", "calcutta": "CCU",
    "hyderabad": "HYD",
    "ahmedabad": "AMD",
    "pune": "PNQ",
    "goa": "GOI",
    "kochi": "COK", "cochin": "COK",
    "jaipur": "JAI",
    "lucknow": "LKO",
    "new york": "JFK", "nyc": "JFK",
    "los angeles": "LAX",
    "boston": "BOS",
    "san francisco": "SFO",
    "london": "LHR",
    "dubai": "DXB",
    "singapore": "SIN",
    "tokyo": "NRT",
}

_MOCK_FLIGHTS = [
    {"id": "AI101", "airline": "Air India", "origin": "DEL", "destination": "BOM", "departure": "06:00", "arrival": "08:05", "price": 4200,  "currency": "INR", "seats": 14},
    {"id": "6E201", "airline": "IndiGo",    "origin": "DEL", "destination": "BOM", "departure": "10:30", "arrival": "12:40", "price": 3650,  "currency": "INR", "seats": 6},
    {"id": "SG301", "airline": "SpiceJet",  "origin": "DEL", "destination": "BOM", "departure": "18:45", "arrival": "20:55", "price": 3100,  "currency": "INR", "seats": 22},
    {"id": "AI102", "airline": "Air India", "origin": "BOM", "destination": "DEL", "departure": "07:15", "arrival": "09:20", "price": 4500,  "currency": "INR", "seats": 9},
    {"id": "AI501", "airline": "Air India", "origin": "DEL", "destination": "BLR", "departure": "08:20", "arrival": "11:05", "price": 5100,  "currency": "INR", "seats": 18},
    {"id": "6E601", "airline": "IndiGo",    "origin": "BLR", "destination": "DEL", "departure": "09:00", "arrival": "11:45", "price": 4800,  "currency": "INR", "seats": 7},
    {"id": "FL001", "airline": "Delta",     "origin": "JFK", "destination": "LAX", "departure": "08:00", "arrival": "11:30", "price": 299,   "currency": "USD", "seats": 12},
    {"id": "EK501", "airline": "Emirates",  "origin": "DEL", "destination": "DXB", "departure": "03:25", "arrival": "05:30", "price": 18500, "currency": "INR", "seats": 20},
]


def _iata(name: str) -> str:
    if not name:
        return ""
    n = name.strip().lower()
    return CITY_TO_CODE.get(n, name.strip().upper())


def _price_str(price: float, currency: str) -> str:
    return f"₹{price:,.0f}" if currency in ("INR", "₹") else f"${price:,.0f}"


async def call_mcp_tool_async(server_cmd: str, server_args: list[str], tool_name: str, arguments: dict) -> dict:
    """Connects to an external Node MCP server running over stdio, initializes session, and calls specified tool."""
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        logger.warning("mcp SDK not installed. Fallback to mock data.")
        return {"error": "mcp_not_installed"}

    server_params = StdioServerParameters(
        command=server_cmd,
        args=server_args,
        env=os.environ.copy()
    )

    try:
        logger.info(f"Connecting to MCP Server: {server_cmd} {' '.join(server_args)}")
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                logger.info("Initializing MCP Session...")
                await session.initialize()
                
                logger.info(f"Invoking tool '{tool_name}' with args {arguments}...")
                result = await session.call_tool(tool_name, arguments=arguments)
                logger.info(f"MCP invocation completed: {result}")
                
                texts = [c.text for c in result.content if hasattr(c, 'text')]
                try:
                    # Try to parse response content as JSON
                    if texts:
                        return {"status": "success", "content": json.loads(texts[0])}
                except Exception:
                    pass
                return {"status": "success", "content": texts}
    except Exception as e:
        logger.error(f"MCP Error: {e}")
        return {"error": str(e)}


async def flight_search(args: dict, session_id: str) -> dict:
    from core.session_state import get_state
    state = get_state(session_id)

    # ── Extract search details ──
    query = args.get("query") or args.get("synopsis") or ""
    
    # Heuristic extraction of cities
    known_cities = {
        "mumbai", "delhi", "chennai", "bangalore", "hyderabad",
        "kolkata", "pune", "ahmedabad", "jaipur", "lucknow"
    }
    words = re.findall(r"[a-zA-Z]+", query.lower())
    cities = [w.title() for w in words if w in known_cities]
    
    # Extract locations, prioritizing manual UI overrides first. No longer hardcodes Mumbai/Delhi if missing!
    origin = state.typed_origin or args.get("origin") or (cities[0] if len(cities) > 0 else "")
    destination = state.typed_destination or args.get("destination") or (cities[1] if len(cities) > 1 else "")
    
    # Validation check: If origin or destination is missing, return a prompt asking for details
    if not origin or not destination:
        msg = "I can definitely search flights for you! Could you please tell me which city you are departing from, and where you are flying to?"
        if not origin and destination:
            msg = f"I've got your destination as {destination}! Which city are you departing from?"
        elif origin and not destination:
            msg = f"I see you are departing from {origin}! What is your destination city?"
            
        return {
            "status": "error",
            "message": "missing_parameters",
            "spoken_reply": msg
        }
    
    # Resolve custom date parsed from the voice transcript query
    # Prioritizes manually filled date first, then explicit voice dates, then defaults to today
    date_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", query)
    if state.typed_date:
        date = state.typed_date
    elif date_match:
        date = date_match.group(1)
    else:
        date = args.get("date") or datetime.date.today().isoformat()

    # Normalize name values
    origin_iata = _iata(origin)
    dest_iata = _iata(destination)

    # ── Detect Service Type ──
    services = {
        "flights": ["flight", "flights", "airport"],
        "hotels": ["hotel", "room", "stay", "lodging"],
        "trains": ["train", "rail", "irctc"],
        "cabs": ["cab", "taxi", "uber", "ola", "rapido"]
    }
    service_type = "flights"
    for svc, keywords in services.items():
        if any(kw in query.lower() for kw in keywords):
            service_type = svc
            break

    logger.info(f"Travel Search: service_type={service_type}, origin={origin}, destination={destination}, query={query}")

    # ── Call Node MCP Server if configured ──
    mcp_response = {}
    if settings.PILOT_MCP_ARGS:
        MCP_SERVER_COMMAND = settings.PILOT_MCP_COMMAND or "node"
        MCP_SERVER_ARGS = shlex.split(settings.PILOT_MCP_ARGS)
        
        # Prioritize the PILOT_MCP_TOOL env/settings if configured
        if settings.PILOT_MCP_TOOL:
            MCP_TOOL_NAME = settings.PILOT_MCP_TOOL
        else:
            MCP_TOOL_MAP = {
                "flights": "get_flights",
                "hotels": "get_hotels",
                "trains": "get_trains",
                "cabs": "get_cabs"
            }
            MCP_TOOL_NAME = MCP_TOOL_MAP.get(service_type, "get_flights")

        mcp_arguments = {
            "serviceType": service_type,
            "origin": origin,
            "destination": destination,
            "query": query
        }

        mcp_response = await call_mcp_tool_async(
            server_cmd=MCP_SERVER_COMMAND,
            server_args=MCP_SERVER_ARGS,
            tool_name=MCP_TOOL_NAME,
            arguments=mcp_arguments
        )

    # ── Check MCP response and fallback if needed ──
    if mcp_response and mcp_response.get("status") == "success":
        content_data = mcp_response.get("content")
        logger.info(f"Successfully retrieved travel info via MCP: {content_data}")
        
        # If it's a dict, we can construct standard response
        if isinstance(content_data, dict):
            summary = content_data.get("summary", "")
            results = content_data.get("results", [])
            source = content_data.get("source", "mcp")
            
            spoken = f"According to real-time search: {summary or 'I found some options for you.'}"
            return {
                "status": "ok",
                "service_type": service_type,
                "origin": origin,
                "destination": destination,
                "date": date,
                "results": results,
                "source": source,
                "spoken_reply": spoken
            }
        else:
            # If string list, join it
            joined_str = " ".join(content_data) if isinstance(content_data, list) else str(content_data)
            return {
                "status": "ok",
                "service_type": service_type,
                "origin": origin,
                "destination": destination,
                "date": date,
                "raw_data": joined_str,
                "spoken_reply": joined_str
            }

    # ── Static fallback data ──
    fallback_data = {
        "flights": [
            {"airline": "Akasa Air", "flight": "QP-1374", "departure": "14:30", "price": "₹3600", "customerCare": "1800-102-3333"},
            {"airline": "SpiceJet", "flight": "SG-157", "departure": "09:15", "price": "₹3900", "customerCare": "1800-102-2333"},
            {"airline": "IndiGo", "flight": "6E-204", "departure": "06:00", "price": "₹4200", "customerCare": "0124-6173838"},
            {"airline": "Air India", "flight": "AI-865", "departure": "07:30", "price": "₹5800", "customerCare": "1860-233-1407"},
            {"airline": "Vistara", "flight": "UK-935", "departure": "11:00", "price": "₹6500", "customerCare": "1860-233-1407"}
        ],
        "hotels": [
            {"hotel": "Hotel Taj", "location": origin, "phone": "1800-266-7646", "price": "₹8500"},
            {"hotel": "Hotel Oberoi", "location": origin, "phone": "1800-102-2333", "price": "₹6200"}
        ],
        "trains": [
            {"operator": "IRCTC Rajdhani", "phone": "139", "departure": "11:30 AM"},
            {"operator": "Shatabdi Express", "phone": "8010500300", "departure": "06:45 PM"}
        ],
        "cabs": [
            {"operator": "Ola Cabs", "phone": "0120-3355335", "price": "₹900 - ₹1200"},
            {"operator": "Uber", "phone": "080-4685-2190", "price": "₹1000 - ₹1400"}
        ]
    }

    results = fallback_data.get(service_type, [])
    
    # Construct spoken fallback reply dynamically based on origin and destination
    if service_type == "flights":
        # Compile a beautifully structured multi-line report detailing all 5 flight options for the transcripts section
        parts = []
        for i, f in enumerate(results[:5]):
            parts.append(f"{i+1}. {f.get('airline', 'Airline')} ({f.get('flight', 'FL')}) departing at {f.get('departure', '00:00')} for {f.get('price', '₹0')}")
        
        spoken = f"Found {len(results)} flights from {origin} to {destination}.\n\n" + "\n".join(parts)
    elif service_type == "hotels":
        spoken = f"Found hotels available in {origin}. The Taj Hotel offers rooms starting at 8,500 Rupees. Customer care number is 1800-266-7646."
    elif service_type == "trains":
        spoken = f"There are 2 train options from {origin} to {destination} today. Rajdhani Express departs at 11:30 AM, or Shatabdi departs at 6:45 PM."
    else:
        spoken = f"Available cab options from {origin} to {destination} include Ola Cabs and Uber, with fares ranging from 900 to 1,500 Rupees."

    return {
        "status": "ok",
        "service_type": service_type,
        "origin": origin,
        "destination": destination,
        "date": date,
        "results": results,
        "source": "fallback — MCP unavailable",
        "spoken_reply": spoken
    }


async def flight_book(args: dict, session_id: str) -> dict:
    fid = args.get("flight_id", "")
    passenger = args.get("passenger_name", "")
    flight = next((f for f in _MOCK_FLIGHTS if f["id"] == fid), None)
    if not flight:
        return {"status": "error", "message": f"Flight {fid} not found in live inventory"}
    ref = f"BK{str(uuid.uuid4())[:6].upper()}"
    logger.info(f"Flight booked: {ref} for {passenger}")
    spoken_reply = f"Successfully booked flight {fid} for {passenger}. Your booking reference is {ref}."
    return {"status": "ok", "booking_ref": ref, "flight": flight, "passenger": passenger, "spoken_reply": spoken_reply}

