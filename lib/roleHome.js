export function roleHomeFor(role) {
  switch (role) {
    case 'admin':
    case 'unternehmer':
      return '/admin';
    case 'kueche':
      return '/kitchen';
    case 'service':
      return '/service';
    default:
      return '/';
  }
}