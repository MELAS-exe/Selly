import { describe, expect, it } from 'vitest';
import { heroCopy, splitTitle } from './hero';

describe('splitTitle', () => {
  it('puts what follows the first comma, or line break, in the accent part', () => {
    expect(splitTitle('Des belles choses, tout près de vous.')).toEqual([
      'Des belles choses,',
      'tout près de vous.',
    ]);
    expect(splitTitle('Le wax\nde Dakar')).toEqual(['Le wax', 'de Dakar']);
    expect(splitTitle('Voom')).toEqual(['Voom', '']);
    expect(splitTitle('Voom,')).toEqual(['Voom,', '']);
  });
});

describe('heroCopy', () => {
  it('uses the vendor words and the defaults for empty lines', () => {
    expect(heroCopy('Voom', null)).toEqual({
      eyebrow: 'Bienvenue chez Voom',
      title: ['Des belles choses,', 'tout près de vous.'],
      text: 'Choisissez, posez vos questions à Selly, et payez en bitcoin, directement à Voom.',
      cta: 'Voir la sélection',
    });
    expect(
      heroCopy('Voom', { eyebrow: 'Nouveautés', title: 'Du style', text: '  ', cta: 'Acheter' }),
    ).toMatchObject({ eyebrow: 'Nouveautés', title: ['Du style', ''], cta: 'Acheter' });
  });
});
