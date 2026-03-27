export interface NormalizeOptions {
    removeAccents?: boolean;
    removeStopwords?: boolean;
    stem?: boolean;
}

const STOPWORDS = new Set([
    'a', 'o', 'um', 'uma', 'de', 'da', 'do', 'no', 'na', 'em', 'por', 'para',
    'com', 'sem', 'sobre', 'entre', 'e', 'ou', 'mas', 'não', 'nem', 'que',
    'qual', 'como', 'tão', 'mais', 'menos', 'muito', 'pouco', 'todo', 'toda',
    'esse', 'essa', 'este', 'esta', 'esse', 'essa', 'aquele', 'aquela',
    'eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'elas', 'me', 'te',
    'se', 'nos', 'vos', 'lhe', 'lhes', 'meu', 'teu', 'seu', 'nosso', 'vosso',
    'meus', 'teus', 'seus', 'nossos', 'vossos', 'minha', 'tua', 'sua', 'nossa',
    'vossa', 'minhas', 'tuas', 'suas', 'nossas', 'vossas', 'é', 'são', 'foi',
    'era', 'será', 'ser', 'estar', 'tendo', 'ter', 'poder', 'dever', 'querer',
    'ver', 'dizer', 'fazer', 'ir', 'vir', 'sair', 'ficar', 'chegar', 'saber',
    'pôde', 'podem', 'pode', 'ainda', 'já', 'agora', 'sempre', 'nunca',
    'aqui', 'ali', 'lá', 'onde', 'quando', 'porque', 'pois', 'assim',
    'também', 'apenas', 'só', 'somente', 'apenas', 'logo', 'portanto',
    'então', 'porém', 'contudo', 'todavia', 'enfim', 'finalmente', 'acerca'
]);

const ACCENT_MAP: Record<string, string> = {
    'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
    'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
    'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
    'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
    'ç': 'c', 'ñ': 'n'
};

export function normalize(text: string, options: NormalizeOptions = {}): string {
    const {
        removeAccents = true,
        removeStopwords = false,
        stem = false
    } = options;

    if (!text || typeof text !== 'string') {
        return '';
    }

    let normalized = text.toLowerCase().trim();

    if (removeAccents) {
        normalized = removeAccentsFromText(normalized);
    }

    normalized = normalized.replace(/[^\w\s]/g, ' ');
    normalized = normalized.replace(/\s+/g, ' ').trim();

    if (removeStopwords) {
        const words = normalized.split(/\s+/);
        const filtered = words.filter(word => !STOPWORDS.has(word));
        normalized = filtered.join(' ');
    }

    if (stem) {
        normalized = simpleStem(normalized);
    }

    return normalized;
}

export function removeAccentsFromText(text: string): string {
    return text.split('').map(char => ACCENT_MAP[char] || char).join('');
}

export function isStopword(word: string): boolean {
    return STOPWORDS.has(word.toLowerCase());
}

export function getStopwords(): string[] {
    return Array.from(STOPWORDS);
}

function simpleStem(text: string): string {
    const words = text.split(/\s+/);
    const stemmed = words.map(word => {
        if (word.length < 4) return word;
        
        if (word.endsWith('ção')) return word.slice(0, -3) + 'ção';
        if (word.endsWith('ções')) return word.slice(0, -4) + 'ção';
        
        if (word.endsWith('mente')) return word.slice(0, -5);
        
        if (word.endsWith('ades')) return word.slice(0, -4) + 'ade';
        if (word.endsWith('ades')) return word.slice(0, -4) + 'ade';
        
        if (word.endsWith('ores')) return word.slice(0, -4) + 'or';
        
        if (word.endsWith('ista')) return word.slice(0, -4) + 'ist';
        if (word.endsWith('istas')) return word.slice(0, -5) + 'ist';
        
        if (word.endsWith('ivo')) return word.slice(0, -3) + 'iv';
        if (word.endsWith('iva')) return word.slice(0, -3) + 'iv';
        if (word.endsWith('ivos')) return word.slice(0, -4) + 'iv';
        if (word.endsWith('ivas')) return word.slice(0, -4) + 'iv';
        
        if (word.endsWith('agem')) return word.slice(0, -4) + 'ag';
        if (word.endsWith('agens')) return word.slice(0, -5) + 'ag';
        
        if (word.endsWith('es')) return word.slice(0, -2);
        if (word.endsWith('rs')) return word.slice(0, -2);
        
        return word;
    });
    
    return stemmed.join(' ');
}
