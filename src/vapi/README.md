# Zuki — Sude'nin Vapi test kurulumu

Bu klasör assistant, sistem promptu, STT/TTS ve lookup tool'unu Vapi REST API ile
kurar. Telefon numarası oluşturmaz/değiştirmez ve arama başlatmaz. Gerçek kafe
numarası ve rezervasyon akışı kapsam dışıdır.

## Sude için kurulum checklist'i

- [ ] [Vapi Dashboard](https://dashboard.vapi.ai) üzerinden hesap aç; doğru test
  organizasyonunu seç. API Keys bölümünden **private** anahtarını al.
- [ ] Phone Numbers → Create Phone Number → Free Vapi Number → US area code →
  Create ile ayrı bir ABD test numarası al, aktivasyonu bekle. **Gerçek kafe
  numarasını import etme, yönlendirme ayarını değiştirme.** Spec'teki “cüzdan
  başına 10 ücretsiz” bilgisi güncel dokümanla uyuşmuyor: güncel hak bir ücretsiz
  numara, ek haklar pakete bağlı. Dashboard'da hesabındaki hakkı kontrol et.
  Numaranın ücretsiz olması görüşmeleri ücretsiz yapmaz. ABD numaralarının
  uluslararası kullanım/transfer kısıtlarını testten önce kontrol et.
- [ ] Node.js 24+ kur. Terminali `review-source` repo kökünde aç ve `npm ci` çalıştır.
- [ ] `.env` yoksa `Copy-Item .env.example .env` çalıştır. Varsa üzerine yazmadan
  örnekteki Vapi değişkenlerini ekle. `.env` gitignore içindedir; commit etme.
- [ ] `VAPI_API_KEY` alanına private anahtarı yaz. `ZUKI_API_BASE_URL` başlangıçta
  `https://zuki-api.example.com` kalabilir; **bu çalışan bir backend değildir**.
- [ ] `ZUKI_TEST_TRANSFER_NUMBER` alanına ulaşılabilir **insan test alıcısının**
  E.164 numarasını (`+` ve ülke koduyla) yaz. Gerçek kafe numarası, yeni aldığın
  inbound assistant numarası veya arayan numara olmamalı; aksi halde yanlış kişiye
  arama/transfer döngüsü oluşabilir. Dry-run'daki kurmaca numarayı canlıda kullanma.
- [ ] `npm run vapi:provision -- --dry-run` ile gönderilecek JSON'u incele.
- [ ] `npm run vapi:provision` çalıştır. Önce `POST /tool`, ardından dönen tool ID'siyle
  `POST /assistant` yapılır. Çıkan `VAPI_LOOKUP_TOOL_ID` ve `VAPI_ASSISTANT_ID`
  satırlarını **hemen `.env` dosyasına kaydet**.
- [ ] Dashboard'da `Zuki - Sude test` assistant'ını aç. Model: OpenAI `gpt-4o-mini`,
  temperature `0`; STT: Deepgram `nova-2`, `en`; TTS: OpenAI `gpt-4o-mini-tts`,
  `alloy`. Bunları kod kurar; dashboard'da mevcut ve kullanılabilir olduklarını
  kontrol et, sesi dinle. Gereken provider erişimini/krediyi Integrations'da ayarla.
  Bu ayarlar Vapi ses katmanına aittir; backend'in Claude ayarını değiştirmez.
- [ ] Tools altında `lookup_zuki_info` ve assistant içinde yerleşik `transferCall`
  bulunduğunu kontrol et. Dashboard taslak/publish durumu gösteriyorsa tool ve
  assistant'ın bu sürümünü Publish/Quick Publish ile etkinleştir.
- [ ] Yalnız **yeni test numarasında** Inbound Settings → Assistant →
  `Zuki - Sude test` → Save. Gerçek kafe numarasına DOKUNMA.
- [ ] Atiye deploy ve şema teyidinden sonra aşağıdaki telefon kabul kontrollerini yap.

## Tekrar çalıştırma ve hata kurtarma

```powershell
npm run vapi:provision -- --dry-run
npm run vapi:provision
```

ID env alanları doluyken script aynı kaynaklara `PATCH` gönderir; boş alan için
yeni kaynak oluşturur. **ID'leri kaydetmeden tekrar çalıştırmak kopya oluşturur.**
Script isimle kaynak aramaz, başka assistant'ları seçmez. Yalnız bu kurulumun
test kaynaklarının ID'lerini kullan. Aynı anda iki provision çalıştırma.

Assistant oluşturulamazsa önce yazdırılmış tool ID'sini `.env`'ye kaydet;
sorunu düzeltip tekrar çalıştır. Timeout/ağ kesilmesinde POST uzakta tamamlanmış
olabilir: yeniden denemeden dashboard'da oluşan kaynağı bul ve ID'sini kaydet.
Script otomatik tekrar deneme/silme yapmaz. HTTP hata kodu terminalde, ayrıntılar
Vapi API Logs'dadır (anahtarların sızmaması için cevap gövdesi loglanmaz).
401/403 için anahtar/organizasyon, 400 için payload/provider ayarı, 429 için
limit kontrolü yap. Kaynakları silmek istersen yalnız bu test kaynaklarını
dashboard'dan seç; numara ilişkisini de kontrol et.

## Endpoint ve geçici response sözleşmesi

Deploy geldiğinde `.env` içindeki **tek URL satırını** değiştir:

```dotenv
ZUKI_API_BASE_URL=https://ATİYE-TARAFINDAN-VERİLEN-HTTPS-HOST
```

Bu satırdaki adresi gerçek deploy adresiyle değiştir, `/api/lookup` ekleme.
Kayıtlı ID'lerle provision'ı tekrar çalıştır; env değişikliği Vapi'ye kendiliğinden
gitmez. Tool `POST {ZUKI_API_BASE_URL}/api/lookup` ve yalnız şu JSON'u gönderir:

```json
{ "query": "How much is a Doppio?" }
```

Sorgu, netleştirme cevabı dahil, kullanıcının sözü olduğu gibi geçirilir.
Modelden geçmiş bağlamı query'ye eklemesi istenmez. Endpoint yalnız query kabul
ettiğinden “the second one” gibi bağlama bağımlı yanıtlar tekrar belirsiz olabilir;
Atiye ile gerçek entegrasyonda teyit et. Asistan bu boşluğu kendi bilgisiyle doldurmaz.

Tool türü **`apiRequest`**: Vapi `body` JSON Schema'yı modelin fonksiyon
parametrelerine dönüştürür ve düz HTTP isteği yapar. `type: function` + `server.url`
Vapi `tool-calls` webhook zarfı bekler; gelecekteki düz REST endpoint'ine uygun
değildir. Tek özel lookup tool'u vardır; `transferCall` yerleşik telefon eylemidir.
JSON cevabı modelin tool sonucuna bütün olarak gider; extraction/boolean mapping
yapılmaz. Beklenen örnek:

```json
{ "status": "not_found", "query": "Do you serve sushi?", "source": "local", "text": "I couldn't identify a source-backed menu item matching that request." }
```

| status | Sesli davranış |
| --- | --- |
| `answered` | `text` aynen okunur, ekleme yapılmaz. |
| `clarification_required` | `text` netleştirme sorusu olarak okunur; cevap beklenir, yeni lookup yapılır. **Transfer yok.** |
| `not_found` | `text` aynen okunur; otomatik transfer yok. Israr/farklı istek sonrası transfer önerilebilir, kabul edilirse yapılır. |
| `transfer_required` | Önce `text`, sonra sabit cümle ve insana transfer. |
| `unavailable` | Önce `text`, sonra sabit cümle ve insana transfer; üç Claude hata reason'ı da aynı davranır. |

Sabit cümle: “I'm not sure about that. Let me transfer you to someone who can help.”
Bu cümle `transferCall.destinations[].message` ile söylenir; prompt ikinci kez
söylemez. HTTP timeout/hata, geçersiz JSON, bilinmeyen status veya boş text'te
cevap uydurmadan aynı transfer fallback'i kullanılır. Rezervasyon nazikçe reddedilir,
transfer önerilir; onaysız rezervasyon transferi veya booking akışı yoktur.

**Sözleşme henüz kesin değil:** `src/assistant/service.ts` beş status'u doğruluyor,
ama Atiye'nin HTTP endpoint'i henüz yok. Şunları onun deploy'unda teyit et:

**Kodda somut entegrasyon farkı:** CLI'nin (`src/index.ts`) kullandığı
`src/assistant/knowledge-safe-service.ts`, `not_found` sonucunu
`transfer_required` olarak değiştiriyor. Mevcut sushi acceptance testi de bu
wrapper davranışını bekliyor. Endpoint bu wrapper'ı doğrudan kullanırsa sushi
otomatik transfer olur ve bu Vapi spec'inin beş status sözleşmesi sağlanmaz.
Atiye ile hangi servisin HTTP'ye açılacağını ve `not_found`'un korunmasını teyit
etmeden mapping'i kesinleştirme. Wrapper'ın transfer text'i sabit kapanışla aynı
olduğundan doğrudan kullanımı cümlenin iki kez okunmasına da yol açabilir.
Bu kurulum backend'i değiştirmez veya gelen status'u tahminle yeniden eşlemez.

- [ ] Beş status aynen, boolean'a indirgenmeden, kök JSON'da `status` ve boş olmayan
  `text` ile HTTP 2xx döner; `unavailable` dahil backend sonuçları korunur.
- [ ] Tool testinde `query` aynen ulaşır, bütün cevap Vapi loglarında görünür.
- [ ] Auth gerekiyorsa Vapi credential entegrasyonu ayrıca kararlaştırılır; bu
  geçici sözleşme lookup endpoint'ine auth header göndermez. Vapi private key'i
  backend'e gönderilmez.
- [ ] Şema farklıysa mapping'i uyarlamadan telefon kabulünü tamamlandı sayma.

## Doğrulama ve telefon kabulü

```powershell
npm test
npm run typecheck
npm run build
```

Yerel testler provision HTTP sırası/payload'ı, tekrar kurulum, hata kurtarma ve
prompt kurallarını kontrol eder. Gerçek Vapi hesabı, LLM davranışı, ses sıralaması
ve telefon bağlantısının kanıtı değildir. Bunlar ayrıca test edilmelidir:

- [ ] Sunday closing, Turkish breakfast, vegan, dog, sushi sorularını sor; her
  faktüel soruda lookup çağrıldığını ve yalnız backend text'inin okunduğunu kontrol et.
- [ ] Belirsiz ürün → `clarification_required`: soruyu aynen okur, transfer etmez;
  cevap sonrası aynı görüşmede yeni lookup görülür.
- [ ] Sushi → `not_found`: uydurma cevap ve otomatik transfer yok.
- [ ] Desteklenmeyen miktar → `transfer_required`: backend text'i tamamlanır,
  sabit cümle bir kez duyulur, ayrı insan test telefonu çalar ve iki yönlü ses vardır.
- [ ] Üç `unavailable` reason'ını kontrollü test backend'inde ayrı ayrı tetikle;
  aynı transfer sıralamasını doğrula. Timeout/500/bozuk JSON için de fallback'i dene.
- [ ] Rezervasyonda reddetme + transfer önerisi, kabul edilmeden transfer olmaması;
  başarısız transferde bağlantı kurulduğu iddiası olmaması kontrol edilir.

Status yönlendirmesi bu aşamada sistem promptuyla yapılır; deterministik bir
telefon state machine'i değildir. Tamamı canlı ses/log testleriyle doğrulanmadan
üretim kabulü verilmez. Provision başarılı olsa da placeholder URL ile bilgi
cevapları çalışmaz. Test numarası ve gerçek çağrı testi Sude'nin manuel adımıdır.

## Referanslar

- [API Request / Function farkı](https://docs.vapi.ai/tools/api-request-vs-function)
- [Tool oluşturma](https://docs.vapi.ai/api-reference/tools/create)
- [Assistant oluşturma](https://docs.vapi.ai/api-reference/assistants/create)
- [Transfer Call](https://docs.vapi.ai/tools/transfer-call)
- [Ücretsiz test numarası](https://docs.vapi.ai/free-telephony)
- [OpenAI TTS](https://docs.vapi.ai/providers/voice/openai)
- [OpenAI model](https://docs.vapi.ai/providers/model/openai)
