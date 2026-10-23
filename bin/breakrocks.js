#!/usr/bin/env node
// The executable: the built CLI (dist/, `npm run build`). During development: `npm start -- <args>`.
import { main } from '../dist/index.js';

process.exitCode = await main(process.argv.slice(2));
