import { useCallback } from 'react';
import { Printer } from 'lucide-react';

/**
 * One-click "Export PDF" using the browser's native print pipeline plus the
 * `@media print` stylesheet (see index.css), which recolours the dark shell to
 * light and drops navigation. No extra dependency, works offline, and the user
 * gets the OS "Save as PDF" target for free.
 *
 * Optionally sets document.title around the print so the suggested filename is
 * meaningful (browsers seed the PDF name from the title).
 */
export function usePrint(documentTitle?: string) {
  return useCallback(() => {
    const previous = document.title;
    if (documentTitle) document.title = documentTitle;
    const restore = () => {
      document.title = previous;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }, [documentTitle]);
}

interface PrintButtonProps {
  documentTitle?: string;
  label?: string;
  className?: string;
}

export function PrintButton({ documentTitle, label = 'Exporter PDF', className = 'btn btn-sm btn-secondary' }: PrintButtonProps) {
  const print = usePrint(documentTitle);
  return (
    <button onClick={print} className={`no-print ${className}`} title="Imprimer / enregistrer en PDF">
      <Printer size={13} /> {label}
    </button>
  );
}
