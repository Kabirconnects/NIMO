import mongoose, {
  Schema,
  type InferSchemaType,
  type Model,
} from "mongoose";

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLoginAt: Date,
  },
  { timestamps: true }
);

export type UserType = InferSchemaType<typeof userSchema>;

const User: Model<UserType> =
  (mongoose.models.User as Model<UserType> | undefined) ??
  mongoose.model<UserType>("User", userSchema);

export default User;
