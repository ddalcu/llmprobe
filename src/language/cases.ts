/** Original prompts, authored for this suite. Eight matched task categories per language. */
export interface LanguageCase {
  id: string;
  language: string;
  category: string;
  prompt: string;
}
const categories = [
  "register",
  "idiom",
  "pragmatics",
  "grammar",
  "localization",
  "culture",
  "creative",
  "ambiguity",
];
const prompts: Record<string, string[]> = {
  EN: [
    "Write two short messages declining a dinner invitation because you are exhausted: one to a close friend and one to a senior colleague. Be warm, clear, and do not invent another commitment. Use English; label each version.",
    "In English, explain “That’s a bit rich coming from you” to an advanced learner. Give a natural two-line dialogue and distinguish it from a comment about wealth. Keep it under 100 words.",
    "A British colleague reviews your proposal and says, “That’s certainly one way of doing it.” In English, give two plausible readings, explain what context would help, and write a tactful reply. Do not assume sarcasm is certain.",
    "Correct this into natural standard English without changing the meaning, then explain the three main corrections: “If I would have known, I would tell you yesterday. Neither of the two options are suitable.”",
    "Adapt “Grab our killer deals before they’re gone!” for a calm, trustworthy UK bookshop newsletter. Give a subject line and one sentence in English. Preserve urgency without violence, shouting, or invented discounts.",
    "In English, advise a visitor invited to a colleague’s home in London for the first time. Give three useful suggestions without claiming all British households follow the same customs. Stay under 100 words.",
    "Write a 70–90-word English scene in which two old friends miss the last bus. Show affection through understated teasing; do not name either character’s emotions or use stereotypes.",
    "In English, explain the two readings of “I saw her duck.” Rewrite it unambiguously for each reading, then give one short context in which each is natural.",
  ],
  CN: [
    "请用简体中文写两条婉拒晚餐邀请的短消息，原因是太累了：一条发给好友，一条发给资深同事。语气温和但明确，不要编造其他安排。标明对象。",
    "用简体中文给高级汉语学习者解释“你可真会挑时候”。写一个自然的两句对话，说明它何时是真夸奖、何时是反话，不要说它一定是讽刺。150字以内。",
    "同事看完你的方案说：“这个想法挺有意思的，我们再研究研究。”用简体中文说出两种可能的言外之意、判断所需的语境，并写一句得体的回应。",
    "把下面的话改成自然的现代汉语，保留原意，并解释三处修改：“虽然他很忙，但是却他每天都坚持练习了中文。我昨天把一本书看，但是没看完。”",
    "把“Grab our killer deals before they’re gone!”改写成适合中国大陆独立书店的简体中文推广文案。写一个标题和一句正文，克制可信，有紧迫感，不要逐字翻译或虚构折扣。",
    "朋友第一次去中国大陆同事家吃饭，担心失礼。用简体中文给三条实用建议，承认家庭和地区差异，不要把饮酒或争着买单说成必须遵守的规矩。180字以内。",
    "用简体中文写一段120—160字的小场景：两位老友错过末班车。用含蓄的打趣体现亲近，不要直接写“他们很开心”“他们很感动”，不要靠方言刻板印象。",
    "“我差点没赶上火车”和“我差点赶上火车”通常分别表示什么？用简体中文解释，并说明口语中的语气或上下文为什么可能让“差点没……”有歧义。各造一个清楚的例句。",
  ],
  TH: [
    "เขียนข้อความภาษาไทยสั้น ๆ สองแบบเพื่อปฏิเสธคำชวนไปกินข้าวเพราะเหนื่อยมาก แบบแรกส่งให้เพื่อนสนิท แบบที่สองส่งให้เพื่อนร่วมงานอาวุโส ใช้น้ำเสียงอบอุ่นแต่ชัดเจน ไม่แต่งเรื่องว่ามีนัดอื่น ผู้พูดเป็นผู้หญิง ระบุว่าแต่ละแบบส่งให้ใคร",
    "อธิบายสำนวน “เกรงใจ” ให้ผู้เรียนภาษาไทยระดับสูงเข้าใจเป็นภาษาไทย ยกบทสนทนาสั้น ๆ และอธิบายว่าทำไมจึงไม่ตรงกับคำว่า afraid เสมอไป ไม่เกิน 120 คำ",
    "เพื่อนร่วมงานตอบคำชวนว่า “ไว้วันหลังนะ” อธิบายเป็นภาษาไทยว่าสื่อได้อย่างน้อยสองแบบ ต้องรู้อะไรเพิ่มจึงจะตีความได้ และควรตอบอย่างไรโดยไม่กดดันเขา",
    "แก้ประโยคนี้ให้เป็นภาษาไทยเขียนที่เป็นธรรมชาติ แล้วอธิบายจุดที่แก้: “ดิฉันพึ่งจะได้รู้ว่าเขาไม่อนุญาติให้จอดรถที่นี่ค่ะ คุณช่วยบอกทางออกให้หน่อยได้ไหมคะค่ะ” รักษาความหมายและเสียงผู้พูดหญิง",
    "ดัดแปลง “Grab our killer deals before they’re gone!” เป็นข้อความประชาสัมพันธ์ร้านหนังสืออิสระในไทย เขียนหัวเรื่องหนึ่งบรรทัดและเนื้อความหนึ่งประโยค สุภาพ น่าเชื่อถือ มีความเร่งด่วนพอประมาณ ไม่แปลตรงตัวและไม่แต่งตัวเลขส่วนลด",
    "ให้คำแนะนำภาษาไทยสามข้อแก่ชาวต่างชาติที่ไปกินข้าวบ้านเพื่อนร่วมงานชาวไทยครั้งแรก กล่าวถึงความแตกต่างระหว่างบ้านด้วย อย่าอ้างว่าคนไทยทุกคนทำเหมือนกัน และอย่าบังคับให้ดื่มแอลกอฮอล์",
    "เขียนฉากสั้นภาษาไทยประมาณ 100–140 คำ เพื่อนเก่าสองคนตกรถเมล์เที่ยวสุดท้าย ให้เห็นความสนิทผ่านการแซวอย่างอ่อนโยน ไม่บอกอารมณ์ตรง ๆ และไม่ใช้ภาพเหมารวมเรื่องภูมิภาค",
    "อธิบายความต่างระหว่าง “ไม่ต้องมา” กับ “มาไม่ต้อง” ในภาษาไทยทั่วไป ข้อความหลังอาจเป็นการพิมพ์ผิดหรือลำดับคำที่ไม่เป็นธรรมชาติได้อย่างไร อย่าสร้างความหมายตายตัวให้ประโยคที่ผิดธรรมชาติ พร้อมเสนอประโยคแก้สองแบบที่มีเจตนาต่างกัน",
  ],
  JP: [
    "疲れているため夕食の誘いを断る短いメッセージを、日本語で二つ書いてください。一つは親友へ、もう一つは職場の先輩へ。温かく明確に断り、別の予定を捏造しないでください。宛先を明記してください。",
    "「それはちょっと……」が断りとして使われる理由を、日本語学習者向けに日本語で説明してください。自然な二往復以内の会話と、必ずしも断りとは限らない例を一つずつ示してください。",
    "上司が提案を聞いて「検討しておきます」と言いました。考えられる解釈を二つ、判断に必要な状況、角の立たない確認の返事を日本語で書いてください。拒否と決めつけないでください。",
    "次の文を自然で適切な敬語に直し、主な修正点を説明してください。「部長が申された資料を拝見されましたか。私は明日、先生の研究室にいらっしゃいます。」最初の質問の相手は同僚で、資料を読むのもその同僚です。",
    "“Grab our killer deals before they’re gone!” を日本の落ち着いた独立系書店の案内に合う日本語へ意訳してください。件名と本文一文。控えめな緊急性を残し、割引率や期間は創作しないでください。",
    "日本の同僚の自宅に初めて夕食に招かれた人へ、日本語で三つ助言してください。家庭による違いに配慮し、贈り物の値段や飲酒を絶対的な義務にしないでください。",
    "終バスを逃した旧友二人の場面を、日本語で200〜260字で書いてください。控えめなからかいで親しさを伝え、感情を直接説明せず、地域のステレオタイプを使わないでください。",
    "「先生は来られます」は文脈によってどう解釈できますか。日本語で主な二つの解釈を説明し、それぞれを曖昧でない文に言い換えてください。",
  ],
  ESP: [
    "Escribe en español dos mensajes breves para rechazar una invitación a cenar porque estás agotada: uno para una amiga íntima y otro para una compañera veterana de trabajo. Sé cálida y clara, sin inventar otro compromiso. Etiqueta las versiones.",
    "Explica en español «Ya era hora» a un estudiante avanzado. Incluye un diálogo de dos líneas y distingue el alivio amistoso del reproche según el contexto. Máximo 100 palabras.",
    "Una compañera de España responde a tu propuesta: «Bueno, ya veremos». Da dos interpretaciones posibles, indica qué contexto ayudaría y escribe una respuesta cortés que no la presione. No des por hecho que es un rechazo.",
    "Corrige para un registro escrito estándar y explica los cambios: «Si tendría tiempo, iría contigo. Habían muchas personas esperando y la dije a Marta que volviera mañana». Conserva el significado y menciona si alguna forma aparece en usos regionales.",
    "Adapta «Grab our killer deals before they’re gone!» para el boletín de una librería independiente de España. Da un asunto y una frase en español: tono tranquilo, fiable y con cierta urgencia, sin traducción literal ni descuentos inventados.",
    "En español, da tres consejos a alguien invitado por primera vez a cenar en casa de un compañero en México. Reconoce diferencias familiares y regionales; no conviertas el alcohol ni una hora fija de retraso en obligaciones. Máximo 110 palabras.",
    "Escribe una escena de 70–90 palabras en español: dos viejos amigos pierden el último autobús. Muestra cariño mediante bromas suaves, sin nombrar sus emociones ni usar estereotipos regionales.",
    "Explica en español la diferencia entre «Aunque llueve, salgo» y «Aunque llueva, salgo». Incluye un contexto natural para cada una y evita reducir la diferencia a presente frente a futuro.",
  ],
  FR: [
    "En français, écris deux messages courts refusant une invitation à dîner parce que tu es épuisée : un à une amie proche, un à une collègue plus expérimentée que tu vouvoies. Sois chaleureuse et claire, sans inventer un autre engagement. Indique les destinataires.",
    "Explique « C’est du joli ! » en français à un apprenant avancé. Donne un dialogue de deux répliques et distingue un emploi ironique d’un véritable compliment. Moins de 100 mots.",
    "Après ta proposition, un collègue répond : « Pourquoi pas, à voir. » Donne en français deux lectures possibles, le contexte utile pour trancher et une réponse diplomatique. Ne conclus pas automatiquement à un refus.",
    "Corrige ces phrases en français standard et explique les changements : « Si j’aurais su, je serais venue. Les lettres que j’ai écrit sont sur la table. Elle s’est permise de partir. » Ne change pas le sens.",
    "Adapte « Grab our killer deals before they’re gone! » au bulletin d’une librairie indépendante en France. Donne un objet et une phrase en français, sobres et crédibles, avec une urgence modérée, sans inventer de remise ni de date.",
    "En français, donne trois conseils à une personne invitée pour la première fois chez une collègue en France. Tiens compte des différences entre foyers ; ne présente ni la bise ni le vin comme obligatoires. Moins de 110 mots.",
    "Écris une scène de 70 à 90 mots en français : deux vieux amis ratent le dernier bus. Fais sentir leur affection par de petites taquineries, sans nommer leurs émotions ni recourir à des stéréotypes régionaux.",
    "Explique en français les deux lectures possibles de « J’ai vu l’homme avec les jumelles ». Réécris la phrase sans ambiguïté pour chaque lecture et donne un bref contexte pour chacune.",
  ],
  GER: [
    "Schreibe auf Deutsch zwei kurze Absagen einer Einladung zum Abendessen, weil du erschöpft bist: eine an einen engen Freund und eine an eine erfahrene Kollegin, die du siezt. Sei freundlich und eindeutig, erfinde keinen anderen Termin. Beschrifte beide Fassungen.",
    "Erkläre „Das hast du ja toll gemacht!“ auf Deutsch für Fortgeschrittene. Gib einen kurzen Dialog und zeige, wie Tonfall und Situation echtes Lob von Ironie unterscheiden. Höchstens 100 Wörter.",
    "Eine Kollegin antwortet auf deinen Vorschlag: „Das können wir uns ja mal anschauen.“ Nenne auf Deutsch zwei plausible Deutungen, hilfreichen Kontext und eine höfliche Rückfrage. Unterstelle keine sichere Ablehnung.",
    "Korrigiere für formelles Standarddeutsch und erkläre die Änderungen: „Wegen dem Regen bin ich zuhause geblieben. Wenn ich das gewusst hätte, würde ich gestern gekommen sein. Das ist der Kollege, wo ich geholfen habe.“ Erwähne gegebenenfalls umgangssprachliche Varianten.",
    "Übertrage „Grab our killer deals before they’re gone!“ frei ins Deutsche für den Newsletter einer ruhigen unabhängigen Buchhandlung. Schreibe Betreff und einen Satz: glaubwürdig, etwas dringlich, ohne erfundene Rabatte oder martialische Sprache.",
    "Gib auf Deutsch drei Tipps für den ersten Abendessensbesuch bei einer Kollegin in Deutschland. Berücksichtige Unterschiede zwischen Haushalten; erkläre weder Alkohol noch minutengenaue Pünktlichkeit zur allgemeingültigen Pflicht. Höchstens 110 Wörter.",
    "Schreibe eine deutsche Szene mit 70–90 Wörtern: Zwei alte Freunde verpassen den letzten Bus. Zeige Zuneigung durch sanftes Necken, ohne Gefühle ausdrücklich zu benennen oder regionale Klischees zu verwenden.",
    "Erkläre auf Deutsch den Unterschied zwischen „Du musst nicht kommen“ und „Du darfst nicht kommen“. Gib je einen natürlichen Kontext und eine eindeutige englische Übersetzung. Achte auf den Geltungsbereich der Verneinung.",
  ],
  KR: [
    "너무 피곤해서 저녁 초대를 거절하는 짧은 한국어 메시지를 두 개 쓰세요. 하나는 친한 친구에게, 하나는 직장 선배에게 보내는 것입니다. 따뜻하지만 분명하게 말하고 다른 약속을 지어내지 마세요. 대상을 표시하세요.",
    "한국어 고급 학습자에게 “눈치가 빠르다”를 한국어로 설명하세요. 짧은 두 줄 대화를 넣고, 단순히 시력이 좋다는 뜻과 어떻게 다른지 설명하세요. 무조건 복종을 잘한다는 뜻으로 설명하지 마세요.",
    "동료가 제안을 듣고 “한번 생각해 볼게요”라고 했습니다. 가능한 해석 두 가지, 판단에 필요한 맥락, 부담을 주지 않는 답장을 한국어로 쓰세요. 반드시 거절이라고 단정하지 마세요.",
    "다음 문장을 자연스러운 표준 한국어로 고치고 수정 이유를 설명하세요. “내일 뵈요. 이 책을 읽는 게 더 낳을 것 같아요. 선생님께서 저에게 말씀을 드렸어요.” 마지막 문장은 선생님이 학생인 나에게 말한 상황입니다.",
    "“Grab our killer deals before they’re gone!”을 한국 독립 서점의 차분한 소식지에 맞게 한국어로 의역하세요. 제목과 본문 한 문장으로 쓰고, 적당한 긴박감은 살리되 할인율이나 마감일을 만들지 마세요.",
    "한국인 동료의 집에 처음 저녁 초대를 받은 사람에게 한국어로 조언 세 가지를 주세요. 가정마다 다름을 인정하고 술을 마시거나 나이에 따른 위계를 무조건 따라야 한다고 말하지 마세요.",
    "막차를 놓친 오랜 친구 둘의 장면을 한국어 6~8문장으로 쓰세요. 가벼운 놀림으로 친밀함을 드러내고 감정을 직접 설명하거나 지역에 대한 고정관념을 쓰지 마세요.",
    "“민수는 영희만 좋아한다”와 “민수만 영희를 좋아한다”의 차이를 한국어로 설명하세요. 각각에서 배제되는 대상이 누구인지 밝히고, 각 문장에 맞는 짧은 상황을 하나씩 쓰세요.",
  ],
  ARABIC: [
    "اكتب بالعربية الفصحى رسالتين قصيرتين للاعتذار عن دعوة إلى العشاء بسبب الإرهاق: واحدة لصديق مقرّب وأخرى لزميل أقدم منك. كن ودودًا وواضحًا ولا تختلق موعدًا آخر. حدّد المخاطَب في كل نسخة.",
    "اشرح بالعربية الفصحى تعبير «على عيني وراسي» لمتعلم متقدم. قدّم حوارًا قصيرًا باللهجة المصرية وبيّن وظيفة التعبير الاجتماعية، ولماذا لا يُفهم حرفيًا. لا تفترض أنه وعد بالتنفيذ في كل سياق.",
    "ردّ زميل على اقتراح موعد بقوله «إن شاء الله». اشرح بالعربية قراءتين محتملتين، وما السياق اللازم للفهم، واكتب متابعة مهذبة لتأكيد الموعد. لا تختزل العبارة في الرفض أو تربطها بصورة نمطية عن المتكلمين.",
    "صحّح الجمل الآتية إلى العربية الفصحى واشرح التغييرات بإيجاز: «إنّ الموظفون مستعدون. لم يذهبُ خالد إلى المكتب. هذه ثلاثة رسائل مهمة». حافظ على المعنى.",
    "كيّف عبارة «Grab our killer deals before they’re gone!» لنشرة مكتبة مستقلة في مصر. اكتب عنوانًا وجملة واحدة بالعربية الفصحى بنبرة هادئة موثوقة وإلحاح معتدل، دون ترجمة حرفية أو اختلاق خصم أو موعد.",
    "قدّم بالعربية ثلاث نصائح لشخص دُعي لأول مرة إلى العشاء في منزل زميل في الأردن. راعِ اختلاف الأسر والأديان والعادات، ولا تفترض جنس المضيف أو تجعل تناول طعام بعينه واجبًا. أقل من 110 كلمات.",
    "اكتب مشهدًا بالعربية الفصحى من 70 إلى 90 كلمة عن صديقين قديمين فاتهما آخر حافلة. أظهر الألفة بمزاح لطيف دون تسمية مشاعرهما مباشرة أو استخدام صور نمطية إقليمية.",
    "الجملة غير المشكولة «زار موسى عيسى» قد يلتبس فيها الفاعل بالمفعول. اشرح بالعربية القراءة الافتراضية وحدود الاعتماد على ترتيب الكلمات هنا، ثم أعد الصياغة مرتين لتوضيح كل احتمال دون الاتكال على علامات إعراب ظاهرة على الاسمين.",
  ],
  POR: [
    "Escreva em português brasileiro duas mensagens curtas recusando um convite para jantar porque você está exausta: uma para uma amiga íntima e outra para uma colega mais experiente. Seja calorosa e clara, sem inventar outro compromisso. Identifique as versões.",
    "Explique em português brasileiro a expressão “Pois não” a um estudante avançado. Dê um diálogo de duas falas e mostre por que ela pode indicar disponibilidade, e não uma recusa. Até 100 palavras.",
    "Um colega brasileiro responde a um convite: “A gente combina”. Em português, apresente duas interpretações possíveis, o contexto necessário e uma resposta gentil para confirmar sem pressionar. Não presuma uma recusa.",
    "Corrija para a escrita formal brasileira e explique as mudanças: “Fazem dois anos que não lhe vejo. Se eu ver a Ana, aviso. Haviam muitas pessoas na fila.” Distinga preferência normativa de usos comuns na fala quando pertinente.",
    "Adapte “Grab our killer deals before they’re gone!” para o boletim de uma livraria independente brasileira. Escreva um assunto e uma frase em português: tom calmo e confiável, urgência moderada, sem tradução literal nem descontos inventados.",
    "Em português europeu, dê três conselhos a quem vai jantar pela primeira vez em casa de um colega em Portugal. Reconheça diferenças entre famílias e não apresente vinho ou beijos como obrigações. Até 110 palavras.",
    "Escreva em português brasileiro uma cena de 70–90 palavras: dois velhos amigos perdem o último ônibus. Mostre afeto por meio de provocações leves, sem nomear as emoções nem usar estereótipos regionais.",
    "Explique em português a diferença entre “Ele deve ter chegado” e “Ele tem de chegar”. Dê um contexto para cada frase e diga por que “dever” nem sempre expressa obrigação.",
  ],
  RUS: [
    "Напишите по-русски два коротких отказа от приглашения на ужин из-за сильной усталости: близкому другу и старшей коллеге, с которой вы на «вы». Тон тёплый, отказ ясный; не придумывайте других планов. Подпишите варианты.",
    "Объясните продвинутому изучающему русский выражение «Ну ты даёшь!». Приведите короткий диалог и покажите, как контекст меняет восхищение на неодобрение. Ответьте по-русски, до 100 слов.",
    "Коллега ответил на предложение: «Ну, посмотрим». По-русски назовите два возможных смысла, необходимый контекст и тактичную уточняющую реплику. Не считайте отказ единственным вариантом.",
    "Исправьте для нейтральной письменной речи и объясните ошибки: «Согласно приказа, нужно оплатить за проезд. Приехав домой, у меня сломался телефон». Во второй фразе домой приехал говорящий; сохраните этот смысл.",
    "Адаптируйте «Grab our killer deals before they’re gone!» для спокойной рассылки независимого книжного магазина. Дайте тему письма и одно предложение по-русски: умеренная срочность, без буквального перевода и выдуманных скидок.",
    "Дайте по-русски три совета человеку, впервые приглашённому на ужин домой к русскоязычному коллеге. Учитывайте различия между семьями и странами; не объявляйте алкоголь или определённый подарок обязательными. До 110 слов.",
    "Напишите по-русски сцену объёмом 70–90 слов: двое старых друзей опоздали на последний автобус. Передайте близость мягкими поддразниваниями, не называя эмоций и не используя региональные стереотипы.",
    "Объясните по-русски разницу между «Он не мог прийти» и «Он мог не прийти». Приведите естественный контекст для каждого и поясните область действия отрицания.",
  ],
  ITA: [
    "Scrivi in italiano due brevi messaggi per rifiutare un invito a cena perché sei esausta: uno a un’amica intima, uno a una collega più esperta a cui dai del Lei. Sii calorosa e chiara, senza inventare altri impegni. Etichetta le versioni.",
    "Spiega in italiano “Ma figurati!” a uno studente avanzato. Dai un breve dialogo e distingui la risposta cortese a un ringraziamento da un uso di incredulità. Massimo 100 parole.",
    "Una collega risponde a una proposta: “Vediamo un po’”. In italiano, presenta due letture plausibili, il contesto utile e una replica garbata per chiarire. Non dare per certo che sia un rifiuto.",
    "Correggi per l’italiano scritto standard e spiega le modifiche: “Se lo sapevo, sarei venuta. A me mi sembra che lui ha ragione. Qual’è il problema?” Distingui, dove serve, usi colloquiali da errori ortografici.",
    "Adatta “Grab our killer deals before they’re gone!” alla newsletter di una libreria indipendente italiana. Scrivi oggetto e una frase: tono pacato e credibile, urgenza moderata, niente traduzioni letterali o sconti inventati.",
    "In italiano, dai tre consigli a chi va per la prima volta a cena a casa di una collega in Italia. Riconosci le differenze tra famiglie e non presentare vino, baci o piatti specifici come obbligatori. Massimo 110 parole.",
    "Scrivi una scena italiana di 70–90 parole: due vecchi amici perdono l’ultimo autobus. Mostra affetto attraverso bonarie prese in giro, senza nominare le emozioni né usare stereotipi regionali.",
    "Spiega in italiano la differenza tra “Non devi venire” e “Devi non venire”. Indica perché la prima può risultare ambigua e proponi due alternative naturali che distinguano assenza di obbligo e divieto.",
  ],
};
export const LANGUAGE_CASES: LanguageCase[] = Object.entries(prompts).flatMap(
  ([language, rows]) =>
    rows.map((prompt, i) => ({
      id: `${language}-${i + 1}`,
      language,
      category: categories[i]!,
      prompt,
    })),
);
LANGUAGE_CASES.push(
  {
    id: "MIX-1",
    language: "MIX",
    category: "translation",
    prompt:
      "Translate “I hear what you’re saying, but I can’t commit to Friday yet” into natural workplace Chinese (simplified), Thai (female speaker), and Japanese (polite). Preserve acknowledgement without implying agreement or a promise. Label the three versions; then explain one nuance per language in English, briefly.",
  },
  {
    id: "MIX-2",
    language: "MIX",
    category: "localization",
    prompt:
      "Write one natural, polite customer-service sentence in each of Spanish (Spain), French (France), German (Germany), and Italian: ask the customer to send the order number so you can check a delay. Use the formal address appropriate to each version, no promise of a refund. Label each language; give only the four sentences.",
  },
  {
    id: "MIX-3",
    language: "MIX",
    category: "translation",
    prompt:
      "Translate “You don’t have to decide today; I just wanted to make sure you knew your options” into Korean (polite), Modern Standard Arabic, Brazilian Portuguese, and Russian (formal address). Preserve reassurance and the absence of obligation. Label each language and give only the four translations.",
  },
  {
    id: "MIX-4",
    language: "MIX",
    category: "code_switching",
    prompt:
      "A multilingual group chat says: Mei: “这个周末我可能来不了。” Nok: “ไม่เป็นไร ไว้คราวหน้าก็ได้” Ken: “無理しないでね。” Ana: “Se der, avisa a gente.” In English, summarize what each person means and the overall social tone. Identify any uncertainty; do not invent reasons or treat any message as a firm promise.",
  },
);
