export default function NotFound() {
  return (
    <main className="shell">
      <div className="lost">
        <h1>This page does not exist.</h1>
        <p>
          It may have moved, or a change was reclassified and its address went
          with it. Every published change is still in the feed.
        </p>
        <p>
          <a className="btn btn-ghost" href="/">
            Back to the latest changes
          </a>
        </p>
      </div>
    </main>
  );
}
