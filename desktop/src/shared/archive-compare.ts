export type ParagraphRelation = "shared" | "unique";

export interface ComparedParagraph {
  readonly text: string;
  readonly relation: ParagraphRelation;
}

export interface AnswerParagraphComparison {
  readonly left: readonly ComparedParagraph[];
  readonly right: readonly ComparedParagraph[];
}

function paragraphs(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized ? normalized.split(/\n[\t ]*\n+/).map((part) => part.trim()).filter(Boolean) : [];
}

export function compareAnswerParagraphs(left: string, right: string): AnswerParagraphComparison {
  const leftParagraphs = paragraphs(left);
  const rightParagraphs = paragraphs(right);
  const leftSet = new Set(leftParagraphs);
  const rightSet = new Set(rightParagraphs);
  return {
    left: leftParagraphs.map((text) => ({
      text,
      relation: rightSet.has(text) ? "shared" : "unique"
    })),
    right: rightParagraphs.map((text) => ({
      text,
      relation: leftSet.has(text) ? "shared" : "unique"
    }))
  };
}
