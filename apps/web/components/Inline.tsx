/**
 * Prose from the impact templates marks identifiers with backticks. Render
 * them as code instead of showing the backticks: "Affects `payment_method_types`
 * on `POST /v1/checkout/sessions`" read as literal punctuation on the page.
 */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}
