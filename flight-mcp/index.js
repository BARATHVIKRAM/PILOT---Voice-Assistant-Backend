import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tavily } from "@tavily/core";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

const server = new McpServer({
  name: "flight-mcp",
  version: "1.0.0",
});

server.tool(
  process.env.PILOT_MCP_TOOL,
  {
    origin: z.string(),
    destination: z.string(),
    query: z.string().optional(),
  },
  async ({ origin, destination }) => {
    const today = new Date().toISOString().split("T")[0];
    const searchQuery = `flight prices ${origin} to ${destination} today ${today} MakeMyTrip Goibibo Cleartrip`;

    try {
      const response = await client.search(searchQuery, {
        searchDepth: "advanced",
        maxResults: 5,
        includeAnswer: true,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            route: `${origin} → ${destination}`,
            date: today,
            summary: response.answer,
            results: response.results.map(r => ({
              title: r.title,
              url: r.url,
              snippet: r.content,
            })),
            source: "web"
          })
        }]
      };

    } catch (err) {
      // fallback to static data if Tavily fails
      console.error("Tavily search failed, using fallback:", err.message);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            route: `${origin} → ${destination}`,
            date: today,
            results: [
              { airline: "IndiGo",    flight: "6E-204",  departure: "06:00", price: "₹4200" },
              { airline: "Air India", flight: "AI-865",  departure: "07:30", price: "₹5800" },
              { airline: "SpiceJet",  flight: "SG-157",  departure: "09:15", price: "₹3900" },
              { airline: "Vistara",   flight: "UK-935",  departure: "11:00", price: "₹6500" },
              { airline: "Akasa Air", flight: "QP-1374", departure: "14:30", price: "₹3600" },
            ],
            source: "fallback — Tavily unavailable"
          })
        }]
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Flight MCP server started");