// Compatibility alias; the registry is the sole source of test membership.
process.argv[2]='audit';
await import('./run-tests.mjs');
