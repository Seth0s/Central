// An agent asked to open a URL. Allowing shows the page in the panel and marks
// that agent as the browser tab's owner.

export default function BrowserAskModal({
  url,
  agentName,
  onDeny,
  onAllow,
}: {
  url: string;
  /** Which agent asked — with up to three panes open, "o agente" is ambiguous. */
  agentName?: string;
  onDeny: () => void;
  onAllow: () => void;
}) {
  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onDeny} />
      <div className="modal" role="dialog" aria-labelledby="perm-title">
        <h3 id="perm-title">Permissão do browser</h3>
        <p>
          {agentName ? <strong>{agentName}</strong> : "O agente"} quer abrir <code>{url}</code>.
        </p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onDeny}>
            Negar
          </button>
          <button type="button" className="primary" onClick={onAllow}>
            Permitir
          </button>
        </div>
      </div>
    </div>
  );
}
