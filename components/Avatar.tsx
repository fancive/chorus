interface AvatarProps {
  initials: string;
  color: string;
  size?: number;
}

export function Avatar({ initials, color, size = 36 }: AvatarProps) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-medium text-white shrink-0"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials.slice(0, 2)}
    </span>
  );
}
