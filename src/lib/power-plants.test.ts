import { describe, it, expect } from 'vitest';
import { parsePowerPlants } from './power-plants';

/**
 * NOTE FOR ANYONE READING THIS LAYER'S DATA: its licence has not been read. The
 * catalogue row says so in its own licence field and the query door carries
 * that sentence onto every answer. These pins describe the SHAPE of the rows
 * and say nothing about whether they may be used.
 */
const HEADER =
  'country,country_long,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,commissioning_year,owner';

describe('parsePowerPlants', () => {
  it('maps a row, lowercasing the fuel that becomes the filter key', () => {
    const [plant] = parsePowerPlants(`${HEADER}\nPOL,Poland,Belchatow,WRI1000001,5298,51.266,19.33,Coal,1988,PGE`);

    expect(plant).toEqual({
      id: 'WRI1000001',
      name: 'Belchatow',
      lat: 51.266,
      lng: 19.33,
      fuel: 'coal',
      capacityMw: 5298,
      country: 'Poland',
      owner: 'PGE',
      commissioningYear: 1988,
    });
  });

  /* The reason this parses CSV properly instead of splitting on commas. A
     quoted owner containing a comma shifts every later column left, so latitude
     is read out of the longitude field: the plant lands somewhere plausible and
     entirely wrong, and nothing fails. */
  it('reads a row whose owner name contains a comma', () => {
    const [plant] = parsePowerPlants(
      `${HEADER}\nUSA,United States,Acme Plant,WRI999,100,40.5,-74.2,Gas,2001,"Acme Power, Inc."`,
    );

    expect(plant.lat).toBe(40.5);
    expect(plant.lng).toBe(-74.2);
    expect(plant.owner).toBe('Acme Power, Inc.');
  });

  it('finds its columns by name, so an inserted column moves nothing', () => {
    const shuffled = 'gppd_idnr,longitude,latitude,name,primary_fuel,inserted_column';
    const [plant] = parsePowerPlants(`${shuffled}\nWRI7,19.33,51.266,Belchatow,Coal,junk`);

    expect(plant.lat).toBe(51.266);
    expect(plant.lng).toBe(19.33);
  });

  /**
   * Number('') is 0 and 0 is finite, so a plain Number() on a blank latitude
   * passes every check and puts the station at [0,0] — a real place in the Gulf
   * of Guinea. This pin caught exactly that on the way in.
   */
  it('skips a row with no usable position rather than defaulting it to nowhere', () => {
    const plants = parsePowerPlants(
      `${HEADER}\nX,X,Ghost,WRI1,,,,Coal,,\nPOL,Poland,Real,WRI2,10,51.2,19.3,Coal,,`,
    );
    expect(plants.map(p => p.id)).toEqual(['WRI2']);
  });

  it('reports an absent number as null, never as zero', () => {
    const [plant] = parsePowerPlants(`${HEADER}\nX,X,Quiet,WRI3,,10,10,Coal,,`);
    expect(plant.capacityMw).toBeNull();
    expect(plant.commissioningYear).toBeNull();
    expect(plant.owner).toBeNull();
  });

  it('names the column it needed when the publisher changes the file', () => {
    expect(() => parsePowerPlants('country,name\nPOL,Belchatow'))
      .toThrow(/latitude|longitude|gppd_idnr/);
  });

  it('throws on an empty body rather than reporting zero stations', () => {
    // Zero plants and could-not-read are different facts, and a layer that
    // reported the first for the second would look like a world with no power.
    expect(() => parsePowerPlants('')).toThrow(/no rows/);
    expect(() => parsePowerPlants(HEADER)).toThrow(/no rows/);
  });
});
