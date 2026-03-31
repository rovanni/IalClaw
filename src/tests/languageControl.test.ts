/**
 * Language Control Layer — Unit Tests
 * 
 * Testa:
 * 1. detectLanguage() — detecção EN, PT, ambígua
 * 2. resolveLanguage() — prioridade input > session > default, anti-flip-flop
 * 3. buildLanguageDirective() — geração de diretivas
 * 4. Continuidade — inputs curtos NÃO alteram idioma da sessão
 * 5. Troca explícita — override de idioma mid-session
 */

import { detectLanguage } from '../i18n';
import {
    resolveLanguage,
    buildLanguageDirective,
    getLanguageLabel,
    DEFAULT_LANGUAGE,
    SessionLike
} from '../core/language/LanguageControlLayer';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.log(`  ❌ ${label}`);
        failed++;
    }
}

function group(title: string) {
    console.log(`\n=== ${title} ===`);
}

// ─── Test 1: detectLanguage() — English ────────────────────────────────
group('detectLanguage — English');

assert(detectLanguage('I want to create a new project') === 'en-US',
    '"I want to create a new project" → en-US');

assert(detectLanguage('Please help me install the package') === 'en-US',
    '"Please help me install..." → en-US');

assert(detectLanguage('Could you show me how to use this tool?') === 'en-US',
    '"Could you show me..." → en-US');

assert(detectLanguage('answer in english') === 'en-US',
    '"answer in english" → en-US (explicit override)');

assert(detectLanguage('switch to english please') === 'en-US',
    '"switch to english please" → en-US (explicit override)');

// ─── Test 2: detectLanguage() — Portuguese ─────────────────────────────
group('detectLanguage — Portuguese');

assert(detectLanguage('Eu quero criar um novo projeto') === 'pt-BR',
    '"Eu quero criar um novo projeto" → pt-BR');

assert(detectLanguage('Por favor me ajude a instalar o pacote') === 'pt-BR',
    '"Por favor me ajude..." → pt-BR');

assert(detectLanguage('Preciso que você me mostre como usar essa ferramenta') === 'pt-BR',
    '"Preciso que você me mostre..." → pt-BR');

assert(detectLanguage('responda em português') === 'pt-BR',
    '"responda em português" → pt-BR (explicit override)');

// ─── Test 3: detectLanguage() — Ambiguous/Null ─────────────────────────
group('detectLanguage — Ambiguous (should return null)');

assert(detectLanguage('ok') === null,
    '"ok" → null');

assert(detectLanguage('') === null,
    '"" (empty) → null');

assert(detectLanguage('123') === null,
    '"123" → null');

// ─── Test 4: resolveLanguage() — Priority input > session > default ─────
group('resolveLanguage — Priority');

const sess1: SessionLike = { language: 'pt-BR' };
const r1 = resolveLanguage('I need help with this project please', sess1, 'user');
assert(r1.lang === 'en-US', 'EN input overrides PT-BR session → en-US');
assert(r1.detectedFromInput === true, 'detectedFromInput is true');
assert(sess1.language === 'en-US', 'Session language updated to en-US');

const sess2: SessionLike = { language: 'en-US' };
const r2 = resolveLanguage('Eu preciso de ajuda com esse projeto agora', sess2, 'user');
assert(r2.lang === 'pt-BR', 'PT input overrides EN session → pt-BR');
assert(sess2.language === 'pt-BR', 'Session language updated to pt-BR');

const sess3: SessionLike = {};
const r3 = resolveLanguage('xyz abc', sess3, 'user');
assert(r3.lang === 'pt-BR', 'Undetectable input + no session lang → pt-BR (default)');

const sess4: SessionLike = { language: 'en-US' };
const r4 = resolveLanguage('xyz abc', sess4, 'user');
assert(r4.lang === 'en-US', 'Undetectable input + EN session → en-US (session preserved)');

// ─── Test 5: resolveLanguage() — Anti-flip-flop (short inputs) ──────────
group('resolveLanguage — Anti-flip-flop (Continuity)');

const sess5: SessionLike = { language: 'en-US' };
const r5 = resolveLanguage('ok', sess5, 'user');
assert(r5.lang === 'en-US', '"ok" preserves EN session');
assert(r5.detectedFromInput === false, 'Not detected from input');
assert(sess5.language === 'en-US', 'Session unchanged');

const sess6: SessionLike = { language: 'en-US' };
const r6 = resolveLanguage('1', sess6, 'user');
assert(r6.lang === 'en-US', '"1" preserves EN session');

const sess7: SessionLike = { language: 'en-US' };
const r7 = resolveLanguage('sim', sess7, 'user');
assert(r7.lang === 'en-US', '"sim" preserves EN session (no flip-flop)');

const sess8: SessionLike = { language: 'pt-BR' };
const r8 = resolveLanguage('yes', sess8, 'user');
assert(r8.lang === 'pt-BR', '"yes" preserves PT session (no flip-flop)');

// ─── Test 6: Continuity Scenario (install ffmpeg flow) ──────────────────
group('Continuity Scenario — install ffmpeg');

const sessFlow: SessionLike = {};
const step1 = resolveLanguage('I need to install ffmpeg on this server', sessFlow, 'user');
assert(step1.lang === 'en-US', 'Step 1: "install ffmpeg..." → en-US');
assert(sessFlow.language === 'en-US', 'Session set to en-US');

// System asks for confirmation, user replies "1"
const step2 = resolveLanguage('1', sessFlow, 'user');
assert(step2.lang === 'en-US', 'Step 2: "1" → preserves en-US (continuity)');
assert(sessFlow.language === 'en-US', 'Session still en-US');

// ─── Test 7: Language Switch Mid-Session ────────────────────────────────
group('Language Switch — Mid-Session');

const sessSw: SessionLike = { language: 'en-US' };
const sw1 = resolveLanguage('agora fale em português por favor', sessSw, 'user');
assert(sw1.lang === 'pt-BR', 'Explicit switch: "fale em português" → pt-BR');
assert(sessSw.language === 'pt-BR', 'Session updated to pt-BR');

const sessSw2: SessionLike = { language: 'pt-BR' };
const sw2 = resolveLanguage('answer in english from now on', sessSw2, 'user');
assert(sw2.lang === 'en-US', 'Explicit switch: "answer in english" → en-US');
assert(sessSw2.language === 'en-US', 'Session updated to en-US');

// ─── Test 8: buildLanguageDirective() ───────────────────────────────────
group('buildLanguageDirective');

const dirPt = buildLanguageDirective('pt-BR');
assert(dirPt.includes('DIRETIVA DE IDIOMA'), 'PT directive has correct header');
assert(dirPt.includes('Português'), 'PT directive mentions Português');
assert(dirPt.includes('DEVE responder'), 'PT directive has enforcement');

const dirEn = buildLanguageDirective('en-US');
assert(dirEn.includes('LANGUAGE DIRECTIVE'), 'EN directive has correct header');
assert(dirEn.includes('English'), 'EN directive mentions English');
assert(dirEn.includes('MUST respond'), 'EN directive has enforcement');

// ─── Test 9: getLanguageLabel() ─────────────────────────────────────────
group('getLanguageLabel');

assert(getLanguageLabel('pt-BR') === 'Português (Brasil)', 'pt-BR → "Português (Brasil)"');
assert(getLanguageLabel('en-US') === 'English', 'en-US → "English"');

// ─── Test 8: Source Parameter - Non-user inputs ─────────────────────────
group('Source Parameter — Non-user inputs preserve language');

const sessSource1: SessionLike = { language: 'en-US' };
const rSrc1 = resolveLanguage('I want to create a project', sessSource1, 'system');
assert(rSrc1.lang === 'en-US', 'system source preserves session lang');
assert(rSrc1.detectedFromInput === false, 'Not detected from input');

const sessSource2: SessionLike = { language: 'pt-BR' };
const rSrc2 = resolveLanguage('Hello world test', sessSource2, 'internal');
assert(rSrc2.lang === 'pt-BR', 'internal source preserves session lang');
assert(rSrc2.detectedFromInput === false, 'Not detected from input');

const sessSource3: SessionLike = {};
const rSrc3 = resolveLanguage('Some text', sessSource3, 'unknown');
assert(rSrc3.lang === DEFAULT_LANGUAGE, 'unknown source uses default language');

// ─── Test 9: Internal Pattern Detection ─────────────────────────────────
group('Internal Pattern Detection');

const sessInternal1: SessionLike = { language: 'en-US' };
const rInt1 = resolveLanguage('🧠 Processing your request', sessInternal1, 'user');
assert(rInt1.lang === 'en-US', 'Emoji pattern preserves session lang');

const sessInternal2: SessionLike = { language: 'en-US' };
const rInt2 = resolveLanguage('Capability Gap detected', sessInternal2, 'user');
assert(rInt2.lang === 'en-US', 'Capability Gap pattern preserves session lang');

const sessInternal3: SessionLike = { language: 'en-US' };
const rInt3 = resolveLanguage('[LOG] Processing', sessInternal3, 'user');
assert(rInt3.lang === 'en-US', '[LOG] pattern preserves session lang');

const sessInternal4: SessionLike = { language: 'en-US' };
const rInt4 = resolveLanguage('instalar skill python', sessInternal4, 'user');
assert(rInt4.lang === 'en-US', '"instalar skill" pattern preserves session lang');

// ─── Results ────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed === 0) {
    console.log('🎉 All tests passed!');
} else {
    console.log('⚠️  Some tests failed!');
    process.exit(1);
}
