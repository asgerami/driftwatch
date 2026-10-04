import { chatCompletion } from "./index";

export async function relay(body: string) {
  return chatCompletion(body);
}
