# Core 3NWeb client library for NodeJS

3NWeb core client library runs all core processes, keeps in-memory state and on-disk caches. Library exposes RPC API that can be used by embedding environments like ElectronJS on desktop and LiquidCore on mobile platforms.


## Development and testing

After repository clone, bring down all NodeJS modules, by running in project's folder:
```bash
npm ci
```

Tests have some unit and integrated components. Integration test uses 3NWeb spec server. Integrated tests use server and dns mocking from `spec-3nweb-server`.

Build is done with
```bash
npm run build
```

Test is done with (after build)
```bash
npm run test
```


## Reuse on non-Node and injecting implementation

To reuse this library in non-Node environments, like Android's jsengine and browser, we need to provide different implementations for access to network, files.

Some of these functions are explicitly passed in setup phases, like naming functionality that may either use DNS of DoH. Switch between these may even be done based on same platform, but depending on user prefernces.

Other functions, like access to device's file system, depend only on environment. For these we use a bit cheaper injection approach. We articulate types that should be implemented. And modules expect to get implementation from `globalThis`. Hence, environments that use core should inject respective implementations at some early stage.

Note that import of implementations of injected for node should be done directly, placing it before other imports that need injected global value(s). Do something like:
```typescript
import { makePlatformDeviceFS } from 'core-3nweb-client-lib/build/injected-globals/inject-on-node';
globalThis.platform = {
	device_fs: makePlatformDeviceFS()
};
import ... // other modules
```
