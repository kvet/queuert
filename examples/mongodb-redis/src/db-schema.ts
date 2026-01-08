import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId;
  name: string;
}

export interface Pet {
  _id?: ObjectId;
  owner_id: ObjectId;
  name: string;
}
