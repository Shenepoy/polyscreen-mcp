<!-- markdownlint-disable MD033 MD060 -->

<div dir="rtl" lang="ar">

<p align="center">
  <img src="assets/polyscreen-logo.svg" alt="شاشات" width="220" />
</p>

<h1 align="center">شاشات — PolyScreen</h1>

<p align="center">
  <span dir="ltr"><strong>polyscreen-mcp</strong></span><br/>
  خادم <span dir="ltr">Model Context Protocol</span> موجّه لأندرويد — أتمتة متعددة الشاشات،<br/>
  أدلة منظَّمة، واستكشاف قدرات الجهاز على أجهزة حقيقية.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/polyscreen-mcp"><img alt="npm" src="https://img.shields.io/npm/v/polyscreen-mcp.svg?style=flat-square&label=npm&color=8B6914" /></a>
  <a href="https://github.com/Zyzto/polyscreen-mcp"><img alt="repo" src="https://img.shields.io/badge/github-Zyzto%2Fpolyscreen--mcp-C0C0C0?style=flat-square" /></a>
  <img alt="node" src="https://img.shields.io/badge/Node.js-%3E%3D22.12-C0C0C0?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="android" src="https://img.shields.io/badge/Android-11%2B-C0C0C0?style=flat-square&logo=android&logoColor=white" />
  <img alt="license" src="https://img.shields.io/badge/license-MPL--2.0-8B6914?style=flat-square" />
</p>

<p align="center">
  <a href="#التثبيت-والبناء">التثبيت</a> ·
  <a href="#إعدادات-العملاء">إعدادات العملاء</a> ·
  <a href="#ماذا-تقدّم">الميزات</a> ·
  <a href="#ملفات-الأدوات">الملفات</a> ·
  <a href="#أهم-الأدوات">الأدوات</a> ·
  <a href="#الأمان">الأمان</a>
  <br/>
  <a href="README.md"><span dir="ltr">English</span></a>
</p>

<p align="center">
  الاسم من العربية: <strong>شاشات</strong> جمع <em>شاشة</em> — ما يُعرَض عليه من واجهات.<br/>
  والاسم اللاتيني <span dir="ltr"><strong>PolyScreen</strong></span> يقرن ذلك بأتمتة متعددة الشاشات.
</p>

</div>

> [!WARNING]
> <div dir="rtl" lang="ar">
>
> **يتطلّب أحدث MCP.** شاشات تتحدث مراجعة بروتوكول <span dir="ltr">Model Context Protocol</span> الحالية (<span dir="ltr"><code>2026-07-28</code></span>). استخدم مضيف MCP حديثًا (Cursor / Claude / VS Code / Codex أو غيره) يتفاوض على هذا العصر. عملاء 2025 فقط قد يتصلون عبر مسار قديم لكنهم يفقدون ميزات حديثة مثل تلميحات <span dir="ltr"><code>tools/list</code></span> القابلة للتخزين و<span dir="ltr"><code>subscriptions/listen</code></span>.
>
> </div>

---

<div dir="rtl" lang="ar">

## لماذا؟

خوادم MCP للأجهزة المحمولة كثيرًا ما:

- تخلط بين معرّفات العرض المنطقية في أندرويد ومعرّفات SurfaceFlinger الفيزيائية؛
- تلتقط شاشةً وتحقُن الإدخال في أخرى؛
- تعرض مجموعة أزرار ثابتة ضيقة؛
- تعامل <span dir="ltr"><code>uiautomator dump</code></span> وكأنه واعٍ بتعدد الشاشات وهو ليس كذلك؛
- تُرجع نصًا نثريًا يضطر الوكيل لتحليله؛
- تكشف أوامر shell غير مقيّدة كأدوات عادية.

**شاشات** تبقي هذه الحدود صريحة وتُرجع أدلة JSON منظَّمة لكل عملية. النواة المحمولة تستخدم <span dir="ltr"><code>adb</code></span> الرسمي وتستكشف قدرات كل جهاز أثناء التشغيل بدل افتراضها من إصدار أندرويد.

على npm: <span dir="ltr"><a href="https://www.npmjs.com/package/polyscreen-mcp"><code>polyscreen-mcp</code></a></span> · المستودع: <span dir="ltr"><a href="https://github.com/Zyzto/polyscreen-mcp">Zyzto/polyscreen-mcp</a></span>

</div>

---

<div dir="rtl" lang="ar">

## ماذا تقدّم؟

| المجال      | ماذا تحصل                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------- |
| **الشاشات** | ربط logical ↔ physical؛ الالتقاط والإدخال يبقيان على نفس الشاشة                                     |
| **الإدخال** | استكشاف <span dir="ltr"><code>input</code></span> على الجهاز — مفاتيح، gamepad، لمس، استهداف الشاشة |
| **الواجهة** | snapshot / find / wait دون اعتبار uiautomator متعدد الشاشات                                         |
| **الأدلة**  | نتائج أدوات JSON منظَّمة (لا نثرًا يُقشَط)                                                          |
| **الجلسات** | تسجيل / focus / logcat غير متزامن مع علامات ومفاتيح زمن جدار                                        |
| **التحليل** | كشف ومضات سوداء/خافتة عبر ffmpeg؛ تقارير theme-flash                                                |
| **الملفات** | <span dir="ltr"><code>core</code></span> مضغوط + تطبيقات وتشخيص وملفات وأداء وcompanion اختيارية    |
| **النقل**   | stdio افتراضيًا؛ Streamable HTTP على loopback مع Host/Origin وbearer اختياري                        |

**المنصات:** أندرويد 11+ (خط أساس تعدد الشاشات). المضيف: Node.js 22.12+ و<span dir="ltr"><code>adb</code></span> على <span dir="ltr"><code>PATH</code></span>.

</div>

---

<div dir="rtl" lang="ar">

## المتطلبات

- Node.js 22.12 أو أحدث
- pnpm 11
- Android platform tools مع <span dir="ltr"><code>adb</code></span> على <span dir="ltr"><code>PATH</code></span>، أو <span dir="ltr"><code>ADB_PATH=/absolute/path/to/adb</code></span>
- أندرويد 11 أو أحدث لخط أساس تعدد الشاشات المدعوم
- <span dir="ltr"><code>ffmpeg</code></span> و<span dir="ltr"><code>ffprobe</code></span> على <span dir="ltr"><code>PATH</code></span> لأداة <span dir="ltr"><code>mobile_analyze_recording</code></span>
- JDK 17 وAndroid SDK فقط عند بناء الـ companion الاختياري

</div>

---

<div dir="rtl" lang="ar">

## التثبيت والبناء

</div>

```bash
pnpm install
pnpm check
pnpm build
```

<div dir="rtl" lang="ar">

stdio يبقى الافتراضي. الخادم يتحدث MCP <span dir="ltr"><code>2026-07-28</code></span> (Streamable HTTP بلا حالة عبر <span dir="ltr"><code>createMcpHandler</code></span>) ويخدم عملاء 2025 القدامى من المصنع نفسه. فضّل عميلًا على هذا الإصدار (أو أحدث) لـ <span dir="ltr"><code>tools/list</code></span> القابل للتخزين و<span dir="ltr"><code>subscriptions/listen</code></span>. أمثلة الربط لـ Cursor وClaude وVS Code وWindsurf وغيرها: [إعدادات العملاء](#إعدادات-العملاء).

</div>

---

<div dir="rtl" lang="ar">

## ملفات الأدوات

ملف <span dir="ltr"><code>core</code></span> الافتراضي مضغوط عمدًا. الملفات الإضافية تعلن أدواتها فقط عند الطلب.

</div>

| Profile        | القدرات                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `core`         | معلومات الخادم، الأجهزة، الشاشات، لقطات، تسجيل/تحليل غير متزامن، focus traces، artifacts، UI، إدخال، تطبيقات |
| `apps`         | الحزم، أدوار التطبيقات الافتراضية، الإشعارات، وبث محدود                                                      |
| `diagnostics`  | شرائح dumpsys، logcat، إيقاظ، وضع الليل، قراءة shared_prefs للتطبيقات القابلة للتصحيح                        |
| `files`        | دفع/سحب مقيّد تحت جذور معتمدة                                                                                |
| `performance`  | لقطات CPU والطاقة والبطارية والذاكرة والإطارات                                                               |
| `device-admin` | منح/سحب أذونات وقت التشغيل صراحةً                                                                            |
| `companion`    | نوافذ accessibility لكل الشاشات ومفاتيح press/down/up صريحة                                                  |
| `all`          | كل الملفات المنفَّذة                                                                                         |

<div dir="rtl" lang="ar">

ملفا <span dir="ltr"><code>unsafe</code></span> وemulator محجوزان ولا يكشفان shell خامًا في هذا الإصدار.

</div>

---

<div dir="rtl" lang="ar">

## إعدادات العملاء

تشغيل stdio (ثبّت الإصدار المنشور):

</div>

```text
npx -y polyscreen-mcp@0.8.0 --profile core diagnostics
```

<div dir="rtl" lang="ar">

<span dir="ltr"><code>diagnostics</code></span> مطلوب لأدوات logcat وactivity tops والإيقاظ ووضع الليل. بعد تعديل الإعداد أو إعادة الاتصال، استدعِ <span dir="ltr"><code>mobile_server_info</code></span> مرة وتأكد أن <span dir="ltr"><code>version</code></span> و<span dir="ltr"><code>toolCount</code></span> يطابقان <span dir="ltr"><code>tools/list</code></span> حديثًا.

</div>

| العميل                | ملف الإعداد                                                                                                    | المفتاح الجذر                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Cursor**            | <span dir="ltr"><code>.cursor/mcp.json</code></span> أو <span dir="ltr"><code>~/.cursor/mcp.json</code></span> | <span dir="ltr"><code>mcpServers</code></span>                                                      |
| **Claude Desktop**    | macOS / Linux / Windows — انظر README الإنجليزي للمسارات                                                       | <span dir="ltr"><code>mcpServers</code></span>                                                      |
| **Claude Code**       | <span dir="ltr"><code>.mcp.json</code></span> أو <span dir="ltr"><code>~/.claude/settings.json</code></span>   | <span dir="ltr"><code>mcpServers</code></span>                                                      |
| **VS Code / Copilot** | <span dir="ltr"><code>.vscode/mcp.json</code></span>                                                           | <span dir="ltr"><code>servers</code></span> (+ <span dir="ltr"><code>"type": "stdio"</code></span>) |
| **Windsurf**          | <span dir="ltr"><code>~/.codeium/windsurf/mcp_config.json</code></span>                                        | <span dir="ltr"><code>mcpServers</code></span>                                                      |
| **Continue**          | <span dir="ltr"><code>.continue/mcpServers/*.yaml</code></span> (مفضّل)                                        | <span dir="ltr"><code>mcpServers</code></span>                                                      |
| **Zed**               | <span dir="ltr"><code>~/.config/zed/settings.json</code></span>                                                | <span dir="ltr"><code>context_servers</code></span>                                                 |
| **Gemini CLI**        | <span dir="ltr"><code>~/.gemini/settings.json</code></span>                                                    | <span dir="ltr"><code>mcpServers</code></span>                                                      |
| **Cline / Roo**       | لوحة MCP Servers → Edit Configuration                                                                          | <span dir="ltr"><code>mcpServers</code></span>                                                      |

<div dir="rtl" lang="ar">

### Cursor / Claude Desktop / Windsurf / Claude Code / Gemini CLI / Cline

نفس شكل <span dir="ltr"><code>mcpServers</code></span> (ادمج في الكائن الموجود):

</div>

```json
{
  "mcpServers": {
    "polyscreen": {
      "command": "npx",
      "args": ["-y", "polyscreen-mcp@0.8.0", "--profile", "core", "diagnostics"]
    }
  }
}
```

<div dir="rtl" lang="ar">

### VS Code (GitHub Copilot)

ملف المساحة <span dir="ltr"><code>.vscode/mcp.json</code></span> — لاحظ مفتاح <span dir="ltr"><code>servers</code></span> (ليس <span dir="ltr"><code>mcpServers</code></span>):

</div>

```json
{
  "servers": {
    "polyscreen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "polyscreen-mcp@0.8.0", "--profile", "core", "diagnostics"]
    }
  }
}
```

<div dir="rtl" lang="ar">

### Continue

المفضّل: <span dir="ltr"><code>.continue/mcpServers/polyscreen.yaml</code></span> في مساحة العمل:

</div>

```yaml
name: PolyScreen MCP
version: 0.8.0
schema: v1
mcpServers:
  - name: polyscreen
    type: stdio
    command: npx
    args:
      - -y
      - polyscreen-mcp@0.8.0
      - --profile
      - core
      - diagnostics
```

<div dir="rtl" lang="ar">

### Zed

<span dir="ltr"><code>~/.config/zed/settings.json</code></span> — <span dir="ltr"><code>command</code></span> و<span dir="ltr"><code>args</code></span> مسطّحان (ليس كائن <span dir="ltr"><code>command.path</code></span>):

</div>

```json
{
  "context_servers": {
    "polyscreen": {
      "command": "npx",
      "args": ["-y", "polyscreen-mcp@0.8.0", "--profile", "core", "diagnostics"]
    }
  }
}
```

<div dir="rtl" lang="ar">

### Streamable HTTP محلي

</div>

```bash
polyscreen-mcp --listen 3300 --token "replace-with-a-secret"
```

<div dir="rtl" lang="ar">

النقطة: <span dir="ltr"><code>http://127.0.0.1:3300/mcp</code></span>. HTTP يرتبط دائمًا بـ loopback، ويتحقق من <span dir="ltr"><code>Host</code></span> و<span dir="ltr"><code>Origin</code></span>، وقد يطلب bearer المُعدّ.

</div>

---

<div dir="rtl" lang="ar">

## أهم الأدوات

</div>

- `mobile_server_info`
- `mobile_devices_list` / `mobile_device_inspect` / `mobile_displays_list`
- `mobile_screen_capture` / `mobile_screen_capture_pair` / `mobile_screen_record`
- `mobile_sessions_status`
- `mobile_record_start` / `mobile_record_mark` / `mobile_record_stop`
- `mobile_analyze_recording` (`mode: "flash"`)
- `mobile_theme_flash_report`
- `mobile_focus_trace` / `mobile_focus_trace_start` / `mobile_focus_trace_stop`
- `mobile_artifacts_list` / `mobile_artifacts_prune`
- `mobile_ui_snapshot` / `mobile_ui_find` / `mobile_ui_wait`
- `mobile_input_tap` / `mobile_input_swipe` / `mobile_input_drag`
- `mobile_input_key` / `mobile_input_key_sequence` / `mobile_input_key_combination` / `mobile_input_text`. <span dir="ltr"><code>mobile_input_key_sequence</code></span> يرسل تسلسلًا موقوتًا: الأرقام بين الأفعال توقف بالملي ثانية وليست ضغطة متزامنة، و<span dir="ltr"><code>x,y</code></span> نقرة (<span dir="ltr"><code>x,y+x,y</code></span> لمسة مركّبة بلا توقف بين النقاط). <span dir="ltr"><code>stepped.checks</code></span> ينفّذ كل فعل على حدة وينتظر ظهور عنصر واجهة قبل الفعل التالي.
- `mobile_app_inspect` / `mobile_app_launch` / `mobile_app_stop` / `mobile_app_relaunch_on_displays`
- `mobile_app_install` / `mobile_app_uninstall`

<div dir="rtl" lang="ar">

كل أداة حسّاسة للشاشة تأخذ <span dir="ltr"><strong>logical</strong></span> <span dir="ltr"><code>displayId</code></span>. التنفيذ يحوّله داخليًا إلى معرّف SurfaceFlinger **فيزيائي**.

لا تخترع serial أبدًا. مرّر القيمة المفضّلة كما هي من <span dir="ltr"><code>mobile_devices_list</code></span>.

للتفاصيل الكاملة (جلسات غير متزامنة، دلاء السطوع، سير عمل الانحدار البصري، companion): انظر <span dir="ltr"><a href="README.md">README.md</a></span>.

</div>

---

<div dir="rtl" lang="ar">

## نموذج تعدد الشاشات

لأندرويد أكثر من فضاء معرّفات:

- **logical** — أعداد صحيحة صغيرة يستخدمها WindowManager وActivityManager و<span dir="ltr"><code>input -d</code></span> وaccessibility؛
- **physical** — معرّفات SurfaceFlinger غير موقَّعة 64-bit لـ <span dir="ltr"><code>screencap -d</code></span> و<span dir="ltr"><code>screenrecord --display-id</code></span>؛
- الشاشات الافتراضية قد تملك logical دون physical قابل للالتقاط.

تُمثَّل المعرّفات الفيزيائية كنصوص عشرية حتى لا يفقد JavaScript الدقة. الربط يعتمد على <span dir="ltr"><code>DisplayInfo.uniqueId</code></span> وعناوين العرض وأدلة محدودة من dumpsys.

</div>

---

<div dir="rtl" lang="ar">

## أين تضغط؟

يوجّه أندرويد اللمسة إلى **آخر عنصر قابل للنقر مرسوم** تحت النقطة، لذا فإن المركز الهندسي للنص كثيرًا ما يكون الإحداثي الخاطئ: النص نفسه غالبًا غير قابل للنقر، وأشرطة البحث العائمة وأزرار التثبيت والألواح السفلية تُرسم فوق الصفوف خلفها.

لذلك تحمل كل عقدة من <span dir="ltr"><code>mobile_ui_snapshot</code></span> و<span dir="ltr"><code>mobile_ui_find</code></span> و<span dir="ltr"><code>mobile_ui_wait</code></span> خطة ضغط محسوبة إلى جانب هندستها الخام:

- <span dir="ltr"><code>center</code></span> — المركز الهندسي كما هو، وقد يعود لعنصر آخر؛
- <span dir="ltr"><code>tap</code></span> — النقطة التي تصل فعلًا إلى العقدة، وهي ما يُمرَّر إلى <span dir="ltr"><code>mobile_input_tap</code></span>؛
- <span dir="ltr"><code>tappable</code></span> — يصبح <span dir="ltr"><code>false</code></span> إذا كانت العقدة خارج الشاشة أو مغطّاة بالكامل؛
- <span dir="ltr"><code>occludedBy</code></span> — العنصر الذي سيبتلع ضغطة المركز؛
- <span dir="ltr"><code>warnings</code></span> — سبب اختلاف الخطة عن المركز أو سبب غيابها.

داخل <span dir="ltr"><code>tap</code></span> يحدّد <span dir="ltr"><code>nodeIndex</code></span> و<span dir="ltr"><code>via</code></span> العنصر الذي يستقبل النقرة: <span dir="ltr"><code>self</code></span> أو حاوية <span dir="ltr"><code>ancestor</code></span> أو <span dir="ltr"><code>unhandled</code></span> حين لا يُعلن أي عنصر في الفرع أنه قابل للنقر. ويصبح <span dir="ltr"><code>adjusted</code></span> صحيحًا حين اضطرت النقطة للابتعاد عن مركز ذلك العنصر تفاديًا لما رُسم فوقه.

العنصر المعطّل يُحسب حاجبًا أيضًا: <span dir="ltr"><code>View.onTouchEvent</code></span> يُرجع <span dir="ltr"><code>clickable</code></span> قبل أن يفحص التفعيل، فالزر الرمادي يبتلع اللمسة دون أن يستجيب لها.

تُعاد السمات المنطقية في مصفوفة <span dir="ltr"><code>flags</code></span> تضم ما هو صحيح فقط، وتُحذف القيم الفارغة، حتى تبقى لقطة من ٥٠٠ عقدة قابلة للقراءة.

عندما تكون العقدة غير قابلة للضغط، مرّر الشاشة أو أغلق ما يغطّيها بدل الضغط على العمياء. كما تُرفض النقاط خارج حدود الشاشة، لأن <span dir="ltr"><code>input tap</code></span> ينجح ظاهريًا ثم يُسقط الحدث.

</div>

---

<div dir="rtl" lang="ar">

## الأمان

- أوامر المضيف مصفوفات argv (لا <span dir="ltr"><code>/bin/sh -c</code></span> على المضيف).
- تُتحقَّق من serial والحزم والمكوّنات والمفاتيح والمسارات ومعرّفات الشاشات.
- طفرات الإدخال/الواجهة تُسلسَل لكل جهاز؛ جلسات record/logcat/focus تتجاوز الطابور عمدًا لتداخل الإدخال.
- للعمليات الفرعية مهلات وإلغاء وحدود مخرجات.
- مسارات الدفع تبقى تحت جذر مضيف الخادم؛ مسارات الجهاز مقتصرة على التخزين المشترك و<span dir="ltr"><code>/data/local/tmp</code></span>.
- لا يُكشَف shell خام ولا root ولا remount ولا عمليات النظام الحساسة.

انظر <span dir="ltr"><a href="SECURITY.md">SECURITY.md</a></span> للإبلاغ ونشر آمن.

</div>

---

<div dir="rtl" lang="ar">

## الاختبار والتطوير

</div>

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

<div dir="rtl" lang="ar">

لا تختر الجهاز الأول صامتًا: مرّر الـ serial الدقيق من <span dir="ltr"><code>mobile_devices_list</code></span>.

قبول الجهاز القابل للتكرار (قراءة غالبًا) والاختبار التخريبي يتطلّبان متغيّرات بيئة صريحة — التفاصيل في <span dir="ltr"><a href="README.md">README.md</a></span>.

</div>

---

<div dir="rtl" lang="ar">

## العلامة

كلمة الشعار بخط <span dir="ltr"><strong><a href="https://www.1001fonts.com/baz-font.html">Baz</a></strong></span> (Baz Light) لـ fakharia (SIL OFL) — نفس الـ typeface في <span dir="ltr"><a href="https://github.com/Zyzto/Siglat">Siglat</a></span> و<span dir="ltr"><a href="https://github.com/Zyzto/Edadat">Edadat</a></span>. الملف في <span dir="ltr"><a href="assets/fonts/baz-Light.otf"><code>assets/fonts/baz-Light.otf</code></a></span>؛ وملف الـ SVG يضم <span dir="rtl">شــاشات</span> كـ outlines (تمطيط بعد <span dir="rtl">ش</span> لا بعد <span dir="rtl">ا</span>) حتى يظهر على GitHub/npm دون تحميل الخط.

</div>

---

<div dir="rtl" lang="ar">

## الرخصة

<span dir="ltr"><a href="LICENSE">MPL-2.0</a></span> — weak copyleft، الاستخدام التجاري مسموح. ملفات الحزمة المعدّلة تبقى تحت MPL؛ تطبيقك يمكن أن يبقى closed-source.

</div>
