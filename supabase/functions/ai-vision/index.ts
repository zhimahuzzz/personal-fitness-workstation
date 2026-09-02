// AI 识别中转函数（部署在 Supabase Edge Functions，名称必须是 ai-vision）
// 功能：餐食文字估算 / 餐食照片识别 / 全身照估体脂率
// 密钥：在 Dashboard → Edge Functions → Secrets 里设置 ZHIPU_API_KEY（智谱 bigmodel.cn 的 API Key）
//
// 为什么需要这个中转：应用部署在 GitHub Pages（纯静态），AI 的 key 不能放前端（公开网页会被扒走盗刷），
// 所以前端只调用自己的 Supabase，由这个函数拿着密钥去调智谱 API。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZHIPU_API = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const VISION_MODEL = "glm-4.6v-flash"; // 视觉理解（免费）
const TEXT_MODEL = "glm-4.7-flash"; // 文本（免费）

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

// 模型有时会包一层 ```json 代码块，这里做剥离 + 提取
function extractJson(text: string): unknown {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const a1 = t.indexOf("[");
  if (a1 >= 0) {
    const a2 = t.lastIndexOf("]");
    if (a2 > a1) return JSON.parse(t.slice(a1, a2 + 1));
  }
  const o1 = t.indexOf("{");
  if (o1 >= 0) {
    const o2 = t.lastIndexOf("}");
    if (o2 > o1) return JSON.parse(t.slice(o1, o2 + 1));
  }
  throw new Error("AI 返回格式异常，请重试");
}

async function zhipu(body: Record<string, unknown>): Promise<string> {
  const key = Deno.env.get("ZHIPU_API_KEY");
  if (!key) throw new Error("未配置 ZHIPU_API_KEY 密钥（Supabase → Edge Functions → Secrets）");
  const resp = await fetch(ZHIPU_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`智谱 API ${resp.status}：${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// 清洗食物明细，防止脏数据进库
function normItems(raw: unknown) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((it: any) => ({
      name: String(it?.name || "").slice(0, 30),
      grams: Math.max(0, Math.round(Number(it?.grams) || 0)),
      kcal: Math.max(0, Math.round(Number(it?.kcal) || 0)),
      p: Math.max(0, Math.round((Number(it?.p) || 0) * 10) / 10),
      c: Math.max(0, Math.round((Number(it?.c) || 0) * 10) / 10),
      f: Math.max(0, Math.round((Number(it?.f) || 0) * 10) / 10),
    }))
    .filter((it: any) => it.name && (it.kcal > 0 || it.grams > 0));
}

const MEAL_SCHEMA =
  '严格只输出 JSON 数组，不要任何解释或 markdown 代码块。每个元素格式：{"name":"食物名","grams":克数,"kcal":热量,"p":蛋白质g,"c":碳水g,"f":脂肪g}，数值均为数字。没有可识别的食物时输出 []。';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    // 验证调用者是已登录用户（supabase.functions.invoke 会自动带上 JWT）
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const authHeader = req.headers.get("Authorization") || "";
    const { data: { user } } = await supabase.auth.getUser(authHeader);
    if (!user) return json({ error: "未登录或登录已过期" }, 401);

    const { task, text, image } = await req.json();

    // 1) 文字估算：食物库没匹配到的部分发给 AI 兜底
    if (task === "meal_text") {
      const desc = String(text || "").slice(0, 500);
      if (!desc.trim()) return json({ items: [] });
      const content =
        `你是专业营养师，熟悉中国常见食物、家常菜和外卖菜品。根据下面的描述估算每种食物的份量（克）与营养。${MEAL_SCHEMA}\n描述：${desc}`;
      const out = await zhipu({
        model: TEXT_MODEL,
        temperature: 0.2,
        messages: [{ role: "user", content }],
      });
      return json({ items: normItems(extractJson(out)) });
    }

    // 2) 餐食照片识别
    if (task === "meal_photo") {
      if (!image) return json({ error: "缺少照片" }, 400);
      const content = [
        {
          type: "text",
          text: `你是专业营养师。识别照片中的全部食物，按常见中国餐饮份量估算每种食物的克数与营养。${MEAL_SCHEMA}`,
        },
        { type: "image_url", image_url: { url: image } },
      ];
      const out = await zhipu({
        model: VISION_MODEL,
        temperature: 0.2,
        messages: [{ role: "user", content }],
      });
      return json({ items: normItems(extractJson(out)) });
    }

    // 3) 全身照估算体脂率
    if (task === "body_fat") {
      if (!image) return json({ error: "缺少照片" }, 400);
      const content = [
        {
          type: "text",
          text: '你是体测分析师。根据照片估算拍摄者的体脂率。仅当照片为全身或大半身、能大致判断体型时给出数值，否则给 null。严格只输出 JSON：{"body_fat_pct": 数字或null, "confidence": "高"|"中"|"低"}，不要任何其他文字。',
        },
        { type: "image_url", image_url: { url: image } },
      ];
      const out = await zhipu({
        model: VISION_MODEL,
        temperature: 0.2,
        messages: [{ role: "user", content }],
      });
      const r = extractJson(out) as any;
      const pct = Number(r?.body_fat_pct);
      return json({
        body_fat_pct: pct > 3 && pct < 70 ? Math.round(pct * 10) / 10 : null,
        confidence: String(r?.confidence || ""),
      });
    }

    return json({ error: "未知任务类型" }, 400);
  } catch (e) {
    return json({ error: (e as Error)?.message || "AI 服务异常，请稍后再试" }, 500);
  }
});
