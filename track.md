```
pnpm tauri dev
pnpm tauri build
```

android 先修改，再执行

```
src-tauri\gen\android\keystore.properties
```

```
pnpm tauri android dev -c src-tauri/tauri.mobile.conf.json
pnpm tauri android build -c src-tauri/tauri.mobile.conf.json
```
