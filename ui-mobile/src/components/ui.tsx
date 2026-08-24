import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

function cx(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button(props: ButtonProps) {
  const { className, type = 'button', variant = 'secondary', ...restProps } = props;

  if (variant === 'primary') {
    return (
      <button
        className={cx(
          'min-h-12 rounded-xl bg-sky-600 px-4 text-base font-medium text-white transition active:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        type={type}
        {...restProps}
      />
    );
  }

  if (variant === 'danger') {
    return (
      <button
        className={cx(
          'min-h-12 rounded-xl border border-red-200 bg-white px-4 text-base font-medium text-red-700 transition active:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        type={type}
        {...restProps}
      />
    );
  }

  return (
    <button
      className={cx(
        'min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base font-medium text-slate-700 transition active:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      type={type}
      {...restProps}
    />
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'select-arrow min-h-12 w-full rounded-xl border border-slate-300 bg-white py-0 pl-3 pr-10 text-base outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'min-h-32 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
        className,
      )}
      {...props}
    />
  );
}
