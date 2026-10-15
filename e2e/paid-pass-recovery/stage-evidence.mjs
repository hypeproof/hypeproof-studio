#!/usr/bin/env node
import { stageEvidence } from './evidence.mjs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('usage: stage-evidence.mjs SOURCE DESTINATION');
stageEvidence(source, destination, [process.env.ANTHROPIC_API_KEY, process.env.GH_TOKEN, process.env.HPS_KEYCHAIN_SCAN_SECRET]);
