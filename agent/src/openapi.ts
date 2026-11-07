// OpenAPI description of the Mandate agent API, so any AI framework can call it
// (ChatGPT custom actions, OpenAI/Gemini function calling, LangChain, etc.).
const json = (schema: any) => ({ 'application/json': { schema } });
const ok = (description: string) => ({ 200: { description, content: json({ type: 'object' }) } });
export const openapi = {
  openapi: '3.1.0',
  info: { title: 'Mandate agent API', version: '0.1.0',
    description: 'Search travel providers, book, and pay with a zero-knowledge Mandate proof: the agent proves it is authorized and within budget without revealing who it works for. Providers are simulated until real partner APIs are connected.' },
  servers: [{ url: 'http://localhost:4400/api' }],
  components: { securitySchemes: { mandateKey: { type: 'http', scheme: 'bearer', description: 'API key created by the agency owner in Team & access > Security (starts with mtk_). Revoking it cuts the AI off immediately.' } } },
  security: [{ mandateKey: [] }],
  paths: {
    '/v1/merchants': { get: { operationId: 'listMerchants', summary: 'List connected travel providers and destinations', responses: ok('providers') } },
    '/v1/search': { get: { operationId: 'searchTravel', summary: 'Search all providers with one free-text query, e.g. "hotels in Lisbon Nov 14 under $200"',
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: ok('ranked offers from all providers') } },
    '/v1/flights': { get: { operationId: 'searchFlights', summary: 'Search one provider for flights',
      parameters: ['provider', 'destination', 'date'].map((n) => ({ name: n, in: 'query', required: true, schema: { type: 'string' } })), responses: ok('fares') } },
    '/v1/hotels': { get: { operationId: 'searchHotels', summary: 'Search one provider for hotel rooms',
      parameters: [{ name: 'city', in: 'query', required: true, schema: { type: 'string' } }, { name: 'date', in: 'query', required: true, schema: { type: 'string' } }, { name: 'provider', in: 'query', required: false, schema: { type: 'string' } }], responses: ok('rooms') } },
    '/v1/mandate': { get: { operationId: 'mandateStatus', summary: "Read this agent's mandate from the public ledger", responses: ok('mandate status') } },
    '/v1/orders': {
      get: { operationId: 'listOrders', summary: 'List unpaid orders', responses: ok('orders') },
      post: { operationId: 'book', summary: 'Create an order from an offer id returned by a search', requestBody: { required: true, content: json({ type: 'object', properties: { offerId: { type: 'string' }, client: { type: 'string', description: 'Client the booking is for (kept off chain)' } }, required: ['offerId', 'client'] }) }, responses: ok('order') } },
    '/v1/orders/{orderId}/pay': { post: { operationId: 'payWithMandate', summary: 'Pay an order with a Mandate proof (about 20 s). The contract refuses over-budget or revoked agents.',
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }], responses: ok('payment result') } },
    '/v1/orders/{orderId}/cancel': { post: { operationId: 'cancelOrder', summary: 'Cancel an unpaid order',
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }], responses: ok('cancelled') } },
  },
};
