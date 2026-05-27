# Terminal Commands
* **Start Engine:** `hytopia start`
* **Dev Loop:** `npm run dev`
* **Package for Portal:** `hytopia package`
* **Cleanup:** (If port 8080 gets stuck.)
  * `npx fuser -k 8080/tcp`
  * **Windows Port Kill:** `Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force`
