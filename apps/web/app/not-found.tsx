import { ArrowRight } from "../components/Marks";

export default function NotFound() {
  return (
    <main className="shell">
      <div className="lost">
        <h1>Nothing charted here.</h1>
        <p>
          The page may have moved, or a change was reclassified and its address
          went with it. Every published change is still in the feed.
        </p>
        <p>
          <a className="link-arrow" href="/">
            Latest changes <ArrowRight size={14} />
          </a>
        </p>
      </div>
    </main>
  );
}
