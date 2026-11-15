/** Links to the project write-ups shown on the homepage. Set a value to a URL (or a file in /public) to make its
 *  button open it; while it is null the button looks normal but does nothing. */
export const LINKS = {
  /** paper/main.pdf, copied into web/public. Re-copy after rebuilding the paper. */
  paper: "/blink-paper.pdf" as string | null,
  /** the Canva deck */
  presentation: "https://canva.link/71g5htsd83htaa7" as string | null,
  /** the demo video */
  video: "https://youtu.be/dxx1mqeylaY" as string | null,
};
