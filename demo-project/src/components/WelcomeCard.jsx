export function WelcomeCard({ title }) {
  return (
    <section>
      <h2>{title}</h2>
      <div onClick={() => console.log("demo click")}>Open details</div>
    </section>
  );
}
