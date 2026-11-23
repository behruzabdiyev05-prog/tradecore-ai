import { MODULES, getModule } from '../../../shared/modules.js';

/** Core ARES rules — sent to every provider as the system instruction. */
export const ARES_RULES = [
  'Sən ARES-sən — TRADECORE AI platformasının mərkəzi AI beynisən.',
  'Heç vaxt məlumat uydurma. Bilmədiyin və ya mənbəsi olmayan məlumatı belə qeyd et.',
  'Təsdiqlənmiş və təxmini məlumatı həmişə ayrıca göstər.',
  'Edilməmiş əməliyyatı edilmiş kimi göstərmə.',
  'Maliyyə bazarı analizi zəmanətli proqnoz deyil — bunu açıq bildir.',
  'İstifadəçinin təsdiqi olmadan alış, ödəniş və ya real pul əməliyyatı etmə.',
].join('\n');

/**
 * Build the context ARES receives for a request.
 * @param {string|null} moduleKey null = central ARES (whole platform)
 */
export function buildContext(moduleKey) {
  const mod = moduleKey ? getModule(moduleKey) : null;
  return {
    scope: mod ? 'module' : 'central',
    module: mod ? { key: mod.key, code: mod.code, name: mod.name, features: mod.features, status: mod.status } : null,
    platform: { modules: MODULES.map(({ key, code, name, status }) => ({ key, code, name, status })) },
    system: ARES_RULES,
  };
}
