# 攤位 3D 編輯器

用 React + Three.js 做的攤位擺放編輯器：分擺設（不可互動）跟商品（可互動，點擊開 3D 預覽），
攤位尺寸可調，支援上傳圖片立牌或真的 3D 模型（.glb / .gltf）。

## 本機執行

需要先裝 [Node.js](https://nodejs.org/)（建議 18 以上）。

```bash
npm install
npm run dev
```

打開終端機顯示的網址（通常是 `http://localhost:5173`）就能看到畫面。

## 放上 GitHub

在專案資料夾內：

```bash
git init
git add .
git commit -m "init: stall 3d editor"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo名稱>.git
git push -u origin main
```

`node_modules` 已經在 `.gitignore` 裡，不會被上傳，其他人 clone 下來後只要 `npm install` 就能跑。

## 部署成網站（讓客人能瀏覽攤位）

任選一個：

**GitHub Pages**
```bash
npm run build
```
會產生 `dist/` 資料夾。可以用 [`gh-pages`](https://www.npmjs.com/package/gh-pages) 套件把 `dist/` 推到 `gh-pages` 分支，
或在 repo 設定的 Pages 選項裡選擇從 `dist` 目錄部署。記得把 `vite.config.js` 裡的 `base` 改成 `'/<repo名稱>/'`。

**Vercel / Netlify**（更簡單，推薦）
把 GitHub repo 連過去，Build command 填 `npm run build`，Output directory 填 `dist`，其他預設值就好，
之後每次 push 到 GitHub 都會自動重新部署。

## 商品 / 擺設資料怎麼存

- 編輯模式左側「匯出 JSON」可以把目前擺放結果（含攤位尺寸、商品座標、價格等）存成 `stall-layout.json`，
  這份檔案可以放進 repo 當「後台資料」，前台頁面日後可以直接 fetch 它來初始化畫面。
- 目前商品瀏覽器內編輯的東西也會自動存在瀏覽器的 `localStorage`（只存在你自己的裝置上，別人開這個網站看不到你編輯的內容）。

## 上傳 3D 模型（.glb）

新增物件時選「上傳 3D 模型 (GLB)」，選檔案後會自動：
- 等比例縮放到約 0.9 公尺高
- 把模型底部對齊地面、水平置中

**注意**：模型檔案會被轉成 base64 直接存進商品資料（`modelData` 欄位），檔案越大，匯出的 JSON 跟自動存檔就越大。
如果模型檔案較多或較大（例如超過幾 MB），建議之後改成：把 `.glb` 檔案直接放進 repo 的 `public/models/` 資料夾，
商品資料只存路徑字串（例如 `"/models/mug.glb"`），這樣 JSON 檔會小很多，也比較適合放上 Git 版本控制。

## 已知限制

- 目前是「你自己編輯攤位」的單人工具，沒有帳號系統，也沒有把資料寫回 GitHub 的自動化（存檔靠匯出 JSON 手動 commit）。
- 沒有做行動裝置的深度優化以外的無障礙細節（例如螢幕閱讀器），純視覺化編輯工具夠用即可。
