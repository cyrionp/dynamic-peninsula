# Dynamic Peninsula — Yapım Planı (Claude Code için)

> Bu dosya bir brief/şablondur. Boş bir GitHub reposuna bağlı Claude Code içinde
> adım adım uygula. Her fazın sonunda derlenebilir ve denenebilir bir çıktı olmalı.
> Repo: `cyrionp/dynamic-peninsula` · Lisans: `MIT OR Apache-2.0` · Hedef: Windows 10/11 (64-bit)

---

## 0. Proje özeti

Ekranın üst ortasından sarkan, hover'da açılan küçük bir "yarımada" (peninsula)
masaüstü uygulaması. Tamamen açık kaynak. Nusa'dan **ilham alınmış ama görünüşü
farklı** olmalı (farklı şekil, renk, yerleşim — kopyalama yok).

**Teknoloji:** Tauri v2 (Rust backend + web frontend/Vite).
**Neden Tauri:** sistem entegrasyonu Rust'ta, akıcı animasyon CSS'te, Windows
installer (NSIS) ve GitHub Actions yayını hazır geliyor.

### Özellikler (v1 kapsamı)
- [ ] **Medya yönetimi** — çalan parçayı göster, oynat/duraklat/ileri/geri (Spotify, tarayıcı, Apple Music vb.)
- [ ] **Hızlı not alma** — tek kutu, anında kaydedilen serbest not
- [ ] **To-do listesi** — ekle/işaretle/sil, kalıcı
- [ ] **Belirli süreli geri sayım** — örn. 25:00 kur, çalışsın, bitince bildirim
- [ ] **İstenen saate kadar geri sayım** — örn. 18:30'a kalan süre
- [ ] **Çoklu kronometre** — birden fazla bağımsız kronometre, başlat/durdur/sıfırla

> **Pomodoro YOK.** Hesap/giriş/takip YOK. Tüm veri kullanıcının bilgisayarında.

---

## 1. İlkeler
- Her faz sonunda `npm run tauri build` **hatasız** derlenmeli.
- Kod İngilizce (değişken/yorum), kullanıcıya görünen metinler sade İngilizce.
- Veriler yerelde: küçük şeyler JSON, listeler için `rusqlite` (SQLite). Tek dosya, kullanıcı klasöründe.
- Pencere: kenarlıksız, şeffaf, her zaman üstte, görev çubuğunda görünmez.
- Performans: boştayken iş yapma, animasyonlar yalnızca hover'da.
- Test döngüsü: Claude yazar → GitHub Actions (Windows) setup üretir → **kullanıcı indirip dener** → geri bildirim → düzeltme.
  (Linux konteynerde Windows build tam derlenemez; doğrulama Actions ve kullanıcı tarafında.)

---

## 2. Repo yapısı (hedef)
```
dynamic-peninsula/
├─ LICENSE-MIT
├─ LICENSE-APACHE
├─ README.md
├─ .gitignore
├─ package.json
├─ vite.config.js
├─ index.html
├─ src/                      # frontend
│  ├─ main.js
│  └─ styles.css
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ build.rs
│  ├─ tauri.conf.json
│  ├─ capabilities/default.json
│  ├─ icons/                 # 32,128,128@2x png + icon.ico
│  └─ src/
│     ├─ main.rs
│     └─ lib.rs
└─ .github/workflows/
   ├─ build.yml              # her push'ta Windows setup (artifact)
   └─ release.yml            # tag'de (v*) GitHub Release
```

---

## 3. Faz 0 — İskelet (önce bu)
Amaç: tepede duran yarımada penceresi + tray ikonu + boş sekmeler, derlenip çalışsın.

- [ ] `npm create tauri-app` yerine dosyaları elle kur (kontrol için) VEYA Tauri v2 CLI ile kur, sonra aşağıdaki ayarlara çek.
- [ ] `tauri.conf.json` penceresi: `decorations:false`, `transparent:true`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, `shadow:false`, boyut ~460x300.
- [ ] Başlangıçta Rust'ta pencereyi **üst-orta**ya konumla (birincil monitör genişliğini al, `LogicalPosition((w-460)/2, 0)`).
- [ ] Tray ikonu + menü: `Show`, `Exit`. (`TrayIconBuilder`, `Menu`, `MenuItem`.)
- [ ] Frontend: `data-state="collapsed|expanded"`, mouseenter'da genişle, mouseleave'de daralt (CSS geçişiyle).
- [ ] İkonlar: `src-tauri/icons/` içine 32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.png koy.
- [ ] `cargo` bağımlılıkları: `tauri = { version = "2", features = ["tray-icon"] }`, `serde`, `serde_json`.

**Çıktı:** Setup kurulunca ekranın tepesinde bir pil görünür, hover'da açılır.

### Önemli pencere/hover notları
- Şeffaf pencerede fare olayları yalnızca boyanmış alanda alınsın; geri kalan şeffaf
  alan tıklamayı geçirsin istenirse `set_ignore_cursor_events` ile oyna (ilk sürümde şart değil).
- Tam ekran uygulamada kenara çekilme Faz 5'e bırakılabilir.

---

## 4. Faz 1 — Çoklu kronometre (mimari kanıtı)
Tamamen frontend'de tutulabilir (sistem API'si yok), mimariyi test etmek için ideal.

- [ ] "Timers" sekmesinde kronometre listesi; `+ Add` ile yeni ekle.
- [ ] Her biri: geçen süre (mm:ss.cs), Start/Pause, Reset, Sil.
- [ ] `requestAnimationFrame` yerine 1 kronometre çalışırken `setInterval(…, 50)` yeterli; hepsi dururken interval'i kapat (boşta CPU=0 ilkesi).
- [ ] İsteğe bağlı: kapanışta çalışan kronometreleri `localStorage`/dosyaya kaydet.

---

## 5. Faz 2 — Kalıcılık + Notlar + To-do
- [ ] Rust tarafında bir veri katmanı: `rusqlite` ile `app_data_dir`/`data.db`.
      (Tauri v2'de `app.path().app_data_dir()`.)
- [ ] Tauri `#[tauri::command]` ile frontend↔Rust köprüsü: `notes_get/set`, `todos_list/add/toggle/delete`.
- [ ] Not: tek textarea, `input` olayında debounced kaydet.
- [ ] To-do: ekle (Enter), checkbox ile tamamla, sil. Açılışta DB'den yükle.

---

## 6. Faz 3 — Geri sayımlar
- [ ] **Süreli geri sayım:** dakika/saniye gir, başlat → yarımadada canlı sayım; bitince bildirim + ince ses.
- [ ] **Saate kadar geri sayım:** hedef saat seç (ör. 18:30); kalan süreyi göster, geçmişse ertesi güne say ya da uyar.
- [ ] Bildirim: `tauri-plugin-notification` (v2). Ses için küçük bir wav frontend'de `Audio`.
- [ ] Sayım yokken timer durmalı.

---

## 7. Faz 4 — Medya yönetimi (en sistemsel kısım)
Windows "now playing" için **GSMTC** kullan.

- [ ] `windows` crate (features: `Media_Control`, `Foundation`) ile
      `GlobalSystemMediaTransportControlsSessionManager::RequestAsync`.
- [ ] Aktif oturumdan: başlık, sanatçı, oynatma durumu, (varsa) kapak.
- [ ] Kontroller: `TryPlayAsync/TryPauseAsync/TrySkipNextAsync/TrySkipPreviousAsync`.
- [ ] Değişimleri olayla dinle (polling yerine `MediaPropertiesChanged`/`PlaybackInfoChanged`),
      frontend'e `emit` ile gönder.
- [ ] Yarımada kapalıyken parça adını kısa göster; açıkken kontrol butonları.

> Not: Lyrics/şarkı sözü istersen sonraki sürümde LRCLIB (lrclib.net) eklenebilir — v1'de şart değil.

---

## 8. Faz 5 — Cila
- [ ] Ayarlar: "Start with Windows" (`tauri-plugin-autostart`), yarımada boyutu, tema.
- [ ] Tam ekran uygulamada gizlenme.
- [ ] Global kısayol (`tauri-plugin-global-shortcut`) ile aç/kapat.
- [ ] Yüksek yenileme hızlı ekranlarda akıcılık, DPI ölçek testleri.

---

## 9. CI/CD — exe/setup yayınlama

### `.github/workflows/build.yml` (her push'ta test setup'ı)
```yaml
name: Build
on:
  push: { branches: [main] }
  workflow_dispatch:
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with: { workspaces: "./src-tauri -> target" }
      - run: npm install
      - run: npm run tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: dynamic-peninsula-setup
          path: src-tauri/target/release/bundle/nsis/*.exe
```
→ Actions sekmesinden derlenen setup'ı indirip dener.

### `.github/workflows/release.yml` (tag atınca GitHub Release)
```yaml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Dynamic Peninsula ${{ github.ref_name }}"
          releaseDraft: true
          prerelease: false
```
→ `git tag v0.1.0 && git push --tags` ile taslak Release + installer otomatik yüklenir.

### İmzalama notu
İmzasız sürümde Windows "Windows protected your PC" uyarısı verir (normal, bağımsız geliştirici).
Açık kaynak için ücretsiz imza yolları var (ör. SignPath OSS programı) — sonra eklenebilir.

---

## 10. Lisans & README
- [ ] `LICENSE-MIT` ve `LICENSE-APACHE` ekle; README'de "Licensed under MIT OR Apache-2.0" yaz.
- [ ] `Cargo.toml` → `license = "MIT OR Apache-2.0"`.
- [ ] README: ne olduğu, ekran görüntüsü, kurulum, geliştirme (`npm install && npm run tauri dev`), katkı, lisans.

---

## 11. .gitignore (asgari)
```
node_modules/
dist/
src-tauri/target/
.DS_Store
```

---

## 12. Claude Code'a verilecek ilk komut (örnek)
> "Bu repoda Tauri v2 tabanlı bir masaüstü uygulaması kuruyoruz. `PLAN.md` dosyasındaki
> Faz 0'ı uygula: tepede duran şeffaf/kenarlıksız/always-on-top yarımada penceresi,
> üst-orta konumlandırma, tray ikonu (Show/Exit), hover'da açılıp kapanan boş sekmeler
> (Timers/Notes/To-do), ikonlar ve build.yml. Derlenebilir olsun, sonra commit'le."

Sonra sırayla Faz 1 → 5 ve en son release.yml ile `v0.1.0` tag'i.
