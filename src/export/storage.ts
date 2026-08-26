// storage.ts — حفظ تلقائي في localStorage.
//
// لا يُستعاد بصمت: الاستعادة تُعلَن في notice وتبقى قابلة للتجاهل بزر «إعادة
// تعيين». مستخدم يفتح الأداة فيجد نموذجاً غريباً بلا تفسير أسوأ من مستخدم
// يفقد جلسة.
//
// كل عملية محاطة بـ try: الوضع الخاص في بعض المتصفحات يجعل localStorage يرمي
// عند الكتابة، وتعطُّل الأداة بسبب حفظ تلقائي فاشل مقايضة سيئة.

import { ProjectFile, ProjectView, buildProject, loadProject } from "./project";
import { BeamModel } from "../engine/types";

const KEY = "beam-analysis:autosave:v1";

export function saveAutosave(model: BeamModel, view: ProjectView): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(buildProject(model, view)));
    return true;
  } catch {
    return false;
  }
}

export function readAutosave(): ProjectFile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = loadProject(raw);
    return r.ok ? r.project : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* لا شيء يُفعل — الحفظ التلقائي كماليّ */
  }
}
