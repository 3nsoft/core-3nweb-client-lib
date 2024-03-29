# Core 3NWeb client library for NodeJS

3NWeb core client library runs all core processes, keeps in-memory state and on-disk caches. Library exposes RPC API that can be used by embedding environments like ElectronJS on desktop and LiquidCore on mobile platforms.


## Development and testing

After repository clone, bring down all NodeJS modules, by running in project's folder:
```
npm ci
```

Tests have some unit and integrated components. Integration test uses 3NWeb spec server. Integrated tests use server and dns mocking from `spec-3nweb-server`.

Build is done with
```
npm run build
```

Test is done with (after build)
```
npm run test
```
