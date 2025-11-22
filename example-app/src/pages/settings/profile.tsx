import { useCall, useFetch } from "helium/client";
import { getProfile, updateProfile } from "helium/server";
import { useEffect, useState } from "react";

export default function ProfilePage() {
    const [profileToEdit, setProfileToEdit] = useState<{
        name: string;
        email: string;
    }>({ name: "", email: "" });

    const { data: profile } = useFetch(getProfile);

    const { call: saveProfile, isCalling } = useCall(updateProfile, {
        invalidate: [getProfile],
    });

    useEffect(() => {
        if (profile) {
            setProfileToEdit(profile);
        }
    }, [profile]);

    return (
        <div>
            <h1 className="text-3xl font-bold mb-4">Profile Settings</h1>
            <div className="space-y-4 w-md">
                <div className="w-full flex flex-col">
                    <label className="block text-slate-400 mb-2">Name</label>
                    <input type="text" value={profileToEdit.name} onChange={(e) => setProfileToEdit({ ...profileToEdit, name: e.target.value })} className="input" />
                </div>
                <div className="w-full flex flex-col  ">
                    <label className="block text-slate-400 mb-2">Email</label>
                    <input type="email" value={profileToEdit.email} className="input" onChange={(e) => setProfileToEdit({ ...profileToEdit, email: e.target.value })} />
                </div>
                <button className="button primary" onClick={() => saveProfile(profileToEdit)}>
                    {isCalling ? "Saving..." : "Save Changes"}
                </button>
            </div>
        </div>
    );
}
