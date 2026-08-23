// Changes tool: git status porcelain + diff --numstat for the active session cwd.

import type { ChangesTool } from "../lib/tool-model";

export default function ChangesToolBody({
  tab,
  onRefresh,
}: {
  tab: ChangesTool;
  onRefresh: () => void;
}) {
  const git = tab.git;
  return (
    <div className="tool-body">
      <div className="panel-head">
        Alterações
        <span className="muted">{git?.repo ? git.branch || "HEAD" : "sem git"}</span>
        <span className="grow" />
        {git?.repo && (
          <span className="git-totals">
            <span className="ins">+{git.insertions}</span>
            <span className="del">−{git.deletions}</span>
          </span>
        )}
        <button type="button" className="tiny" onClick={onRefresh}>
          Atualizar
        </button>
      </div>
      {!git?.repo && <p className="muted tool-empty">Esta pasta não é um repositório git.</p>}
      {git?.repo && git.entries.length === 0 && <p className="muted tool-empty">Working tree limpa.</p>}
      {git?.repo && git.entries.length > 0 && (
        <ul className="git-list">
          {git.entries.map((e) => (
            <li key={e.path}>
              <span className="git-st">{e.status}</span>
              <span className="git-path" title={e.path}>
                {e.path}
              </span>
              <span className="git-stat">
                {e.insertions > 0 && <span className="ins">+{e.insertions}</span>}
                {e.deletions > 0 && <span className="del">−{e.deletions}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
