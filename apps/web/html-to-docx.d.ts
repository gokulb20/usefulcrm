declare module "html-to-docx" {
  interface HtmlToDocxOptions {
    table?: { row?: { cantSplit?: boolean } };
    footer?: boolean;
    pageNumber?: boolean;
    [key: string]: unknown;
  }
  export default function htmlToDocx(
    htmlString: string,
    headerHtml?: string | null,
    options?: HtmlToDocxOptions,
  ): Promise<Blob>;
}
