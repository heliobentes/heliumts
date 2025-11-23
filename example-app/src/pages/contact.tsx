"use ssg";

export default function ContactPage() {
    return (
        <div>
            <h1>Contact Us</h1>
            <p>Get in touch with the Helium team</p>
            <form>
                <div>
                    <label>Name</label>
                    <input type="text" />
                </div>
                <div>
                    <label>Email</label>
                    <input type="email" />
                </div>
                <button type="submit">Send</button>
            </form>
        </div>
    );
}
