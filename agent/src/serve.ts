// Run Mandate without Claude Desktop: web app + REST API for any AI agent.
// npm run serve   ->  http://localhost:4400  (app)   http://localhost:4400/api/v1/openapi.json (API)
import './harden.js'; // first: mask secrets in all terminal output
import { startServices } from './core.js';
startServices();
