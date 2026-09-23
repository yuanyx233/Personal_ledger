// Shared by the settings sections, including LanguageSettings, so it lives apart
// from SettingsPage rather than being imported back out of it.
export function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="settings-section-heading">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}
