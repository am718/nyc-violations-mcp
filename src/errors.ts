/** An error whose message is safe and useful to show to the agent, including how to recover. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
