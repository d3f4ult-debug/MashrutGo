import enum


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    UYUSHMA_ADMIN = "uyushma_admin"
    DRIVER = "driver"
    CLIENT = "client"
