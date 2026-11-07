// Mandate MCP server: exposes the agent core as MCP tools for any MCP-capable AI client
// (Claude Desktop today). stdout is the MCP channel, so every log goes to stderr.
console.log = console.error; console.info = console.error; console.debug = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ops, startServices } from './core.js';
import { providerIds } from './merchants.js';
import { NETWORK_NAME } from './config.js';

startServices();
const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const server = new McpServer({ name: 'mandate', version: '0.2.0' });
const flightIds = providerIds('flights') as [string, ...string[]];
const hotelIds = providerIds('hotels') as [string, ...string[]];

server.registerTool('list_merchants', {
  description: 'List the connected travel providers (airlines, OTAs, hotels) and the destinations they serve.',
  inputSchema: {},
}, async () => text(ops.listMerchants()));

server.registerTool('search_travel', {
  description: 'Search ALL connected providers at once with one plain-language query, like a search engine. Examples: "flights to Lisbon 2026-11-14 under $250", "hotels in Lisbon Nov 14 under $200". Returns a combined list ranked by price, each with its provider and an offer id to book.',
  inputSchema: { query: z.string() },
}, async ({ query }) => text(ops.searchTravel(query)));

server.registerTool('search_flights', {
  description: 'Search one specific provider for flights.',
  inputSchema: { provider: z.enum(flightIds), destination: z.string().describe('City or airport code'), date: z.string().describe('YYYY-MM-DD') },
}, async ({ provider, destination, date }) => text(ops.searchFlights(provider, destination, date)));

server.registerTool('search_hotels', {
  description: 'Search one specific provider for hotel rooms.',
  inputSchema: { city: z.string(), date: z.string().describe('YYYY-MM-DD'), provider: z.enum(hotelIds).optional() },
}, async ({ city, date, provider }) => text(ops.searchHotels(city, date, provider)));

server.registerTool('book', {
  description: 'Create an order for an offer id (fareId or roomId) from a search, for a named client of the agency (e.g. "Smith family"). It must then be paid with pay_with_mandate. The client name stays in the agency\'s private records and is never sent on chain.',
  inputSchema: { offerId: z.string(), client: z.string().describe('Who this booking is for, e.g. "Smith family"') },
}, async ({ offerId, client }) => text(ops.book(offerId, client, 'Claude Desktop (MCP)')));

server.registerTool('cancel_order', {
  description: 'Cancel an unpaid order (for example a duplicate booking).',
  inputSchema: { orderId: z.string() },
}, async ({ orderId }) => text(ops.cancel(orderId, 'Claude Desktop (MCP)')));

server.registerTool('list_orders', { description: 'List unpaid orders.', inputSchema: {} }, async () => text(ops.listOrders()));

server.registerTool('mandate_status', {
  description: "Show this agent's spending mandate as recorded on the Midnight ledger: travel limit per period and whether the agent is authorized.",
  inputSchema: {},
}, async () => text(await ops.status()));

server.registerTool('pay_with_mandate', {
  description: 'Pay an order with a zero-knowledge Mandate proof: proves the agent is authorized and within its travel budget without revealing who it works for. Takes about 20 seconds. The contract refuses payments that are over budget or from a revoked agent.',
  inputSchema: { orderId: z.string() },
}, async ({ orderId }) => text(await ops.pay(orderId, 'Claude Desktop (MCP)')));

await server.connect(new StdioServerTransport());
console.error(`[mandate-mcp] ready on ${NETWORK_NAME}`);
