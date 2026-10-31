#!/usr/bin/env node
// The executable: the built CLI (dist/, `npm run build`). During development: `npm start -- <args>`.
import { main, exitWhenDone } from '../dist/index.js';

exitWhenDone(await main(process.argv.slice(2)));
