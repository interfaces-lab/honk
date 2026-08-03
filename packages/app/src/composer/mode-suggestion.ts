import type { ModeId } from "../modes";

type ModeSuggestion = "plan" | "debug";
type ModeSuggestionUsage = Readonly<Record<ModeSuggestion, boolean>>;

const PLAN_KEYWORDS = Object.freeze(
  [
    "plan|planning|refactor|migrate|restructure|design|architect|spec|specify|outline|draft|blueprint|proposal|roadmap|strategy|approach|steps|checklist|timeline|milestones|phased|staged|rollout|implementation|execution|workflow|scope|estimate|breakdown|todo|acceptance criteria|definition of done",
    "计划|重构|迁移|重组|设计|方案|路线图|步骤|草案|蓝图|策略|工作流|时间表|阶段性|执行|范围|估算|任务分解|验收标准|完成定义",
    "jihua|chonggou|qianyi|chongzu|sheji|fangan|luxiantu|buzhou|caoan|lantu|celue|gongzuoliu|shijianbiao|jieduanxing|zhixing|fanwei|gusun|renwufenjie|yanshoubiaozhun|wanchengdingyi",
    "योजना|पुनर्गठन|स्थानांतरण|पुनर्संरचना|रूपरेखा|डिज़ाइन|खाका|कार्ययोजना|समयरेखा|रणनीति|कार्यान्वयन|चरणबद्ध|नक्शा|अनुमान|विभाजन|स्वीकृति मापदंड|पूर्णता परिभाषा",
    "planificar|planificación|refactorización|migrar|reestructurar|diseñar|especificar|hoja de ruta|borrador|pasos|estrategia|implementación|ejecución|flujo de trabajo|cronograma|etapas|estimación|desglose|criterios de aceptación|definición de hecho",
    "planifier|refactoriser|migrer|restructurer|concevoir|spécifier|feuille de route|brouillon|étapes|stratégie|mise en œuvre|exécution|flux de travail|calendrier|phases|estimation|décomposition|critères d'acceptation|définition de terminé",
    "خطة|تخطيط|إعادة هيكلة|ترحيل|إعادة تصميم|تصميم|مخطط|خارطة طريق|مسودة|خطوات|استراتيجية|تنفيذ|جدول زمني|مراحل|تقدير|نطاق|انهيار المهام|معايير القبول|تعريف الاكتمال",
    "পরিকল্পনা|পুনর্গঠন|স্থানান্তর|নকশা|রূপরেখা|রোডম্যাপ|খসড়া|ধাপ|কৌশল|সময়সূচী|বাস্তবায়ন|পর্যায়|আনুমানিক|পরিসর|কাজের প্রবাহ|গ্রহণযোগ্যতার মানদণ্ড|সম্পূর্ণতার সংজ্ঞা",
    "planejar|planejamento|refatorar|migrar|reestruturar|desenhar|especificar|roteiro|rascunho|etapas|estratégia|implementação|execução|fluxo de trabalho|cronograma|fases|estimativa|escopo|decomposição|critérios de aceitação|definição de concluído",
    "план|планировать|рефакторинг|миграция|реструктуризация|архитектура|спецификация|дорожная карта|черновик|шаги|стратегия|реализация|исполнение|рабочий процесс|график|этапы|оценка|объем|разделение задач|критерии приёмки|определение готовности",
    "計画|リファクタリング|移行|再構築|設計|仕様|仕様書|ロードマップ|草案|戦略|実装|実行|ワークフロー|タイムライン|段階的|見積もり|範囲|分解|受け入れ基準|完了の定義",
    "keikaku|rifakutaringu|ikou|saikouchiku|sekkei|shiyou|shiyousho|roodomaapu|soun|senryaku|jissou|jikkou|waakufurou|taimurain|dankaiteki|mitsumori|han'i|bunkai|ukeire kijun|kanryou no teigi",
  ].flatMap((group) => group.split("|")),
);

function suggestedModeForPrompt(
  prompt: string,
  currentMode: ModeId,
  used: ModeSuggestionUsage,
): ModeSuggestion | null {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const suggestsPlan =
    PLAN_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
    /[.!?]+/u.test(normalized) ||
    normalized.split(/\s+/u).length >= 35;
  const planEligible = suggestsPlan && currentMode !== "plan" && !used.plan;
  if (planEligible) return "plan";

  // "bug" also matches "debug" and "debugging" as a substring.
  if (normalized.includes("bug") && currentMode !== "debug" && !used.debug) return "debug";
  return null;
}

export { suggestedModeForPrompt };
export type { ModeSuggestion, ModeSuggestionUsage };
