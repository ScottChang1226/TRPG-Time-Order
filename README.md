# 📅 時間協調工具

像 Doodle / When2Meet 的免費時間投票工具，支援即時同步與 Google 日曆匯出。

**線上版本**：https://scottchang1226.github.io/TRPG-Time-Order/

---

## 功能

### 帳號系統
- **Email / 密碼** 註冊登入
- **Google 帳號** 一鍵登入（OAuth）
- 登入後以 UID 識別，防止假冒姓名重複投票

### 可收合側邊欄
- 📋 **我建立的活動** — 列出自己建立的所有活動
- 👥 **我參加過的活動** — 列出曾填寫時間的活動
- 🌙 **深色模式** — 一鍵切換亮色／深色主題，設定自動儲存
- 點選任一活動可直接跳轉

### 活動功能
- 建立活動並設定多個候選時間段（支援 24 小時制手動輸入）
- **📅 批次套用日期範圍** — 指定日期範圍 + 時間，一鍵對每天新增一個時間段
- 產生分享連結，讓所有人填寫可用時間（✅ 可以 / 🟡 大概可以 / ❌ 不行）
- 即時顯示結果，以熱力圖排序所有時間段
- 自動標出「所有人都有空」的時間
- 一鍵新增最佳時段到 **Google 日曆**（無需 API 金鑰）
- 🗑️ **刪除活動**（建立者）— 軟刪除，168 小時內仍可查閱與下載資料
- 🚪 **離開活動**（參與者）— 刪除自己的填寫記錄並退出活動

### 下載離線檔案
| 按鈕 | 格式 | 說明 |
|------|------|------|
| ⬇ 下載 HTML | `.html` | 可直接用瀏覽器開啟的離線報表 |
| 📊 下載 Excel | `.xlsx` | 可用 Excel / Numbers 開啟 |
| 📄 下載 CSV | `.csv` | 純文字，通用格式 |

---

## 專案檔案結構

```
.
├── index.html              # 入口頁面（僅引入 CSS / JS）
├── style.css               # 所有樣式（含深色模式）
├── app.js                  # 主程式邏輯（ES Module）
├── firebase-config.js      # Firebase 設定（已加入 .gitignore，不會上傳）
├── firebase-config.example.js  # 設定範本（可安全提交）
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions 自動部署設定
└── README.md
```

> `firebase-config.js` 不會進入版本控制。實際部署時由 GitHub Actions 從 Secrets 自動產生。

---

## 全新部署步驟

### 第一步：建立 Firebase 專案（免費）

1. 前往 [Firebase Console](https://console.firebase.google.com)
2. 點「建立專案」→ 輸入名稱 → 選**免費 Spark 方案**
3. 左側選單點「**Firestore Database**」→「建立資料庫」→ 選「**測試模式**」
4. 左側選單點「**Authentication**」→「開始使用」→ 啟用：
   - **電子郵件/密碼**
   - **Google**（填入支援 Email）
5. 點左上角齒輪 ⚙️ →「**專案設定**」→「**您的應用程式**」→「**&lt;/&gt;**（網頁）」
6. 輸入暱稱 → 複製 `firebaseConfig` 物件的各欄位值備用

### 第二步：Fork 並設定 GitHub Secrets

1. Fork 此 repository 到你的 GitHub 帳號
2. 進入 repo → **Settings → Secrets and variables → Actions**
3. 點「New repository secret」，逐一新增以下 6 個 Secrets：

| Secret 名稱 | 對應 Firebase 欄位 |
|---|---|
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |

### 第三步：啟用 GitHub Pages

進入 repo → **Settings → Pages** → Source 選 **Deploy from a branch** → Branch 選 **`gh-pages`** → 儲存。

### 第四步：設定 Firebase 授權網域

Firebase Console → **Authentication → Settings → 已授權網域** → 新增：
```
你的帳號.github.io
```

### 第五步：觸發部署

將任何變更 push 到 `main` branch，GitHub Actions 即自動部署。  
或到 repo → **Actions → Deploy to GitHub Pages → Run workflow** 手動觸發。

部署完成後網址為：`https://你的帳號.github.io/repo名稱/`

---

## 日常維護：修改後如何 Push & Deploy

只要修改 `index.html`、`style.css`、`app.js` 任一檔案後，執行：

```bash
git add .
git commit -m "描述這次的修改"
git push origin main
```

**GitHub Actions 會在 push 後自動執行部署**，約 1～2 分鐘後線上版本更新。  
可至 repo → **Actions** 標籤查看部署進度。

> ⚠️ 請勿手動 push 或修改 `gh-pages` branch，那是 Actions 自動管理的。

---

## Firestore 安全規則（正式使用）

在 Firebase Console → **Firestore Database → 規則** 標籤，貼上以下規則並點「**發布**」：

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // polls：登入者可讀；建立者可建立；登入者可更新 responses；建立者可軟刪除
    match /polls/{pollId} {
      allow read: if request.auth != null;

      allow create: if request.auth != null
        && request.resource.data.creatorUid == request.auth.uid;

      allow update: if request.auth != null && (
        resource.data.creatorUid == request.auth.uid
        ||
        request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['responses'])
      );

      allow delete: if false;
    }

    // userPolls：只有本人可讀寫自己的參與記錄
    match /userPolls/{docId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.uid;
    }
  }
}
```

---

## 使用流程

```
建立者                            參與者
   |                                |
   ├── 點「建立新活動」              |
   ├── 填入活動名稱、時間段          |
   │   （或用批次日期範圍功能）      |
   ├── 取得活動代碼 / 分享連結       |
   │                                ├── 開啟分享連結
   │                                ├── 選擇可用時間
   │                                └── 提交
   │                                |
   └── 開啟結果頁面（即時同步）
       ├── 查看熱力圖排序
       ├── 看到最佳時間段
       ├── 點「加入 Google 日曆」
       └── 下載 HTML / Excel / CSV
```

---

## 技術說明

| 項目 | 技術 | 費用 |
|------|------|------|
| 前端 | HTML + CSS + Vanilla JS（ES Modules） | 免費 |
| 身分驗證 | Firebase Authentication | 免費：不限用戶數 |
| 資料庫 | Firebase Firestore（Spark 方案） | 免費：1GB 儲存、50K 讀/天、20K 寫/天 |
| 托管 | GitHub Pages（自動部署） | 免費 |
| CI/CD | GitHub Actions | 免費（public repo） |
| Google 日曆 | URL Scheme（無需 API 金鑰） | 免費 |
| Excel 匯出 | SheetJS CDN | 免費（MIT 授權）|

> Firebase Spark 免費額度對一般小型 TRPG 活動綽綽有餘。
