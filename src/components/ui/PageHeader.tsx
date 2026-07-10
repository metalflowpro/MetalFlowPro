interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumb?: string[];
  icon?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions, breadcrumb, icon }: PageHeaderProps) {
  return (
    <div className="px-8 pt-8 pb-6 border-b border-mf-border">
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-mf-txt4 mb-3">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-mf-border">›</span>}
              <span>{crumb}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-10 h-10 rounded-xl bg-mf-panel border border-mf-border flex items-center justify-center text-mf-gold shrink-0">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-mf-txt">{title}</h1>
            {subtitle && <p className="text-sm text-mf-txt3 mt-1">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-mf-panel border border-mf-border flex items-center justify-center mb-4 text-mf-txt4">
        {icon}
      </div>
      <h3 className="text-base font-medium text-mf-txt2 mb-2">{title}</h3>
      <p className="text-sm text-mf-txt4 max-w-sm mb-6">{description}</p>
      {action}
    </div>
  );
}

interface SectionProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, subtitle, actions, children, className = '' }: SectionProps) {
  return (
    <div className={`card ${className}`}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="section-title">{title}</div>
          {subtitle && <div className="section-sub">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
