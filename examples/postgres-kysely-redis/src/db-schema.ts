import { Generated, Insertable, Selectable, Updateable } from "kysely";

export interface Database {
  users: UserTable;
  pet: PetTable;
}

export interface UserTable {
  id: Generated<number>;
  name: string;
}
export type User = Selectable<UserTable>;
export type NewUser = Insertable<UserTable>;
export type UserUpdate = Updateable<UserTable>;

export interface PetTable {
  id: Generated<number>;
  owner_id: number;
  name: string;
}
export type Pet = Selectable<PetTable>;
export type NewPet = Insertable<PetTable>;
export type PetUpdate = Updateable<PetTable>;
