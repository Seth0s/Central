// Shown while no agent is open.

export default function EmptyState() {
  return (
    <div className="empty">
      <img className="home-mark" src="/brand/logo.png" alt="CentralByte" />
      <h1>Sessão no centro</h1>
      <p>Novo chat na barra esquerda. Ferramentas no + da barra direita.</p>
      <ol>
        <li>Abre uma pasta no ícone de pasta dos repositórios</li>
        <li>Cria uma sessão na pasta e adiciona um agente (fixture se não houver CLI)</li>
        <li>Vista CLI é o TUI; Chrome traduz o mesmo processo. /resume é o do vendor.</li>
      </ol>
    </div>
  );
}
