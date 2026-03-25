export type LoadedSkill = {
    /** Nome canônico da skill (campo `name` do frontmatter). */
    name: string;
    /** Descrição resumida usada para detecção automática de intenção. */
    description: string;
    /** Dica de argumento exibida ao usuário (campo `argument-hint`). */
    argumentHint: string;
    /** Corpo da skill — todo o conteúdo Markdown após o frontmatter. */
    body: string;
    /** Caminho absoluto do SKILL.md no disco. */
    sourcePath: string;
    /** Origem da skill: interna ao repositório ou baixada publicamente. */
    origin: 'internal' | 'public';
    /** Frases de ativação free-text carregadas do skill.json (invocation.freeText). */
    triggers: string[];
};
